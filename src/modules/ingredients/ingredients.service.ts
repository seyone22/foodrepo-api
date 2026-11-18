import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { GoogleGenAI } from "@google/genai";
import { db } from "@/database/database.module";
import {
  DerivativeItem,
  IngredientLink,
  ingredientRedirects,
  ingredients,
  mappings,
  priceHistories,
  priceSources,
  products,
  queryEmbeddings,
  usdaFoods,
  auditLogs,
} from "@/database/schema";
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { toPgId } from "@/common/utils/uuid.util";
import { ImageWaterfallService } from "./image-waterfall.service";
import { GraphTraversalService } from "../graph/graph-traversal.service";

type IngredientRow = typeof ingredients.$inferSelect;
type ProductRow = typeof products.$inferSelect;

export interface IIngredientData extends Omit<IngredientRow, "embedding"> {
  products?: ProductRow[];
  nutrition?: typeof usdaFoods.$inferSelect;
}

export interface IngredientSearchResponse {
  results: IIngredientData[];
  page: number;
  totalPages: number;
  total: number;
}

export interface SearchOptions {
  page?: number;
  limit?: number;
  country?: string | null;
  autosuggest?: boolean;
  cuisine?: string | null;
  region?: string | null;
  flavor?: string | null;
  includeProducts?: boolean;
}

const EMBEDDING_DIMENSIONS = 3072;
const EMBEDDING_MODEL = "gemini-embedding-001";

const ingredientColumns = {
  id: ingredients.id,
  name: ingredients.name,
  aliases: ingredients.aliases,
  country: ingredients.country,
  cuisine: ingredients.cuisine,
  region: ingredients.region,
  flavorProfile: ingredients.flavorProfile,
  dietaryFlags: ingredients.dietaryFlags,
  provenance: ingredients.provenance,
  comment: ingredients.comment,
  pronunciation: ingredients.pronunciation,
  image: ingredients.image,
  partOf: ingredients.partOf,
  derivatives: ingredients.derivatives,
  varieties: ingredients.varieties,
  usedIn: ingredients.usedIn,
  substitutes: ingredients.substitutes,
  pairsWith: ingredients.pairsWith,
  density: ingredients.density,
  fdcId: ingredients.fdcId,
  reviewStatus: ingredients.reviewStatus,
  reviewReason: ingredients.reviewReason,
  claimedUntil: ingredients.claimedUntil,
  lastModified: ingredients.lastModified,
  createdAt: ingredients.createdAt,
  updatedAt: ingredients.updatedAt,
};

@Injectable()
export class IngredientsService {
  private ai: GoogleGenAI | null = null;

  constructor(
    private readonly imageWaterfallService: ImageWaterfallService,
    private readonly graphTraversalService: GraphTraversalService,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  private async embedText(text: string): Promise<number[]> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not defined in environment");
    }
    const response = await this.ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: EMBEDDING_DIMENSIONS },
    });
    const embeddingValues =
      (response as any).embeddings?.[0]?.values ||
      (response as any).embedding?.values;
    if (!embeddingValues) {
      throw new Error("Failed to extract embedding values from Gemini API response");
    }
    return embeddingValues as number[];
  }

  async getDescendantIngredientIds(rootId: string): Promise<string[]> {
    const root = await db.query.ingredients.findFirst({
      where: eq(ingredients.id, toPgId(rootId)),
      columns: { id: true, name: true, varieties: true },
    });
    if (!root) return [rootId];

    const visited = new Set<string>([root.id]);
    const rootNameLower = root.name.trim().toLowerCase();

    const partOfChildren = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(
        sql`${ingredients.partOf} @> ${JSON.stringify([{ id: root.id }])}::jsonb OR EXISTS (SELECT 1 FROM jsonb_array_elements(${ingredients.partOf}) elem WHERE lower(elem->>'name') = ${rootNameLower})`,
      );

    for (const c of partOfChildren) {
      visited.add(c.id);
    }

    if (root.varieties && root.varieties.length > 0) {
      const varietyIds = root.varieties
        .filter((v) => v?.id)
        .map((v) => v.id as string);
      const varietyNames = root.varieties
        .filter((v) => !v?.id && v?.name?.trim())
        .map((v) => v.name.trim().toLowerCase());

      if (varietyIds.length > 0) {
        for (const id of varietyIds) visited.add(id);
      }
      if (varietyNames.length > 0) {
        const varietyChildren = await db
          .select({ id: ingredients.id })
          .from(ingredients)
          .where(inArray(sql`lower(${ingredients.name})`, varietyNames));

        for (const c of varietyChildren) {
          visited.add(c.id);
        }
      }
    }

    return Array.from(visited);
  }

  async attachProducts<T extends { id: string }>(
    rows: T[],
  ): Promise<(T & { products: ProductRow[] })[]> {
    if (rows.length === 0) return [];

    const descendantsMap = new Map<string, string[]>();
    const allNeededIngredientIds = new Set<string>();

    for (const r of rows) {
      const descIds = await this.getDescendantIngredientIds(r.id);
      descendantsMap.set(r.id, descIds);
      descIds.forEach((id) => allNeededIngredientIds.add(id));
    }

    const queryIds = Array.from(allNeededIngredientIds);
    if (queryIds.length === 0) {
      return rows.map((r) => ({ ...r, products: [] }));
    }

    const rels = await db
      .select({
        matchedIngredients: mappings.matchedIngredients,
        product: products,
      })
      .from(mappings)
      .innerJoin(products, eq(products.id, mappings.productId))
      .where(
        sql`${mappings.matchedIngredients} && ARRAY[${sql.join(
          queryIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]`,
      );

    const directMap = new Map<string, ProductRow[]>();
    for (const rel of rels) {
      for (const ingId of rel.matchedIngredients ?? []) {
        if (!allNeededIngredientIds.has(ingId)) continue;
        const list = directMap.get(ingId) ?? [];
        list.push(rel.product);
        directMap.set(ingId, list);
      }
    }

    return rows.map((r) => {
      const descIds = descendantsMap.get(r.id) ?? [r.id];
      const seenProductIds = new Set<string>();
      const rowProducts: ProductRow[] = [];

      for (const dId of descIds) {
        const prodList = directMap.get(dId) ?? [];
        for (const p of prodList) {
          if (!seenProductIds.has(p.id)) {
            seenProductIds.add(p.id);
            rowProducts.push(p);
          }
        }
      }

      return {
        ...r,
        products: rowProducts,
      };
    });
  }

  async searchIngredientsVector(
    query: string,
    options: SearchOptions = {},
  ): Promise<IngredientSearchResponse> {
    const {
      page = 1,
      limit = 20,
      country,
      cuisine,
      region,
      flavor,
      includeProducts = false,
    } = options;

    const cleanQuery = query.trim();
    if (!cleanQuery) return { results: [], page: 1, totalPages: 0, total: 0 };

    const offset = (page - 1) * limit;

    const cached = await db
      .select({ embedding: queryEmbeddings.embedding })
      .from(queryEmbeddings)
      .where(eq(queryEmbeddings.query, cleanQuery))
      .limit(1);

    let queryVector: number[];
    if (cached.length > 0) {
      queryVector = cached[0].embedding as number[];
    } else {
      queryVector = await this.embedText(cleanQuery);
      await db
        .insert(queryEmbeddings)
        .values({ query: cleanQuery, embedding: queryVector });
    }

    const filters: SQL[] = [];
    if (country) filters.push(sql`${ingredients.country} @> ARRAY[${country}]::text[]`);
    if (cuisine) filters.push(sql`${ingredients.cuisine} @> ARRAY[${cuisine}]::text[]`);
    if (region) filters.push(sql`${ingredients.region} @> ARRAY[${region}]::text[]`);
    if (flavor) filters.push(sql`${ingredients.flavorProfile} @> ARRAY[${flavor}]::text[]`);

    const whereClause =
      filters.length > 0
        ? and(sql`${ingredients.embedding} IS NOT NULL`, ...filters)
        : sql`${ingredients.embedding} IS NOT NULL`;

    const [results, totalResult] = await Promise.all([
      db
        .select(ingredientColumns)
        .from(ingredients)
        .where(whereClause)
        .orderBy(cosineDistance(ingredients.embedding, queryVector))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: sql<number>`count(*)` })
        .from(ingredients)
        .where(whereClause),
    ]);

    const total = Number(totalResult[0]?.value ?? 0);
    const finalResults =
      includeProducts && results.length > 0
        ? await this.attachProducts(results)
        : results;

    return {
      results: finalResults,
      page,
      totalPages: Math.ceil(total / limit) || 0,
      total,
    };
  }

  async searchIngredients(
    query: string,
    options: SearchOptions = {},
  ): Promise<IngredientSearchResponse> {
    const {
      page = 1,
      limit = 20,
      country,
      cuisine,
      region,
      flavor,
      includeProducts = false,
      autosuggest = false,
    } = options;

    const cleanQuery = query.trim();
    const offset = (page - 1) * limit;

    const filters: SQL[] = [];
    if (cleanQuery && cleanQuery !== "%") {
      const pattern = `%${cleanQuery}%`;
      filters.push(
        sql`(${ingredients.name} ILIKE ${pattern} OR EXISTS (SELECT 1 FROM unnest(${ingredients.aliases}) a WHERE a ILIKE ${pattern}))`,
      );
    }
    if (country) filters.push(sql`${ingredients.country} @> ARRAY[${country}]::text[]`);
    if (cuisine) filters.push(sql`${ingredients.cuisine} @> ARRAY[${cuisine}]::text[]`);
    if (region) filters.push(sql`${ingredients.region} @> ARRAY[${region}]::text[]`);
    if (flavor) filters.push(sql`${ingredients.flavorProfile} @> ARRAY[${flavor}]::text[]`);

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const isExactMatch = sql<number>`CASE WHEN LOWER(${ingredients.name}) = LOWER(${cleanQuery}) THEN 1 ELSE 0 END`;
    const isStartsWith = sql<number>`CASE WHEN ${ingredients.name} ILIKE ${cleanQuery + "%"} THEN 1 ELSE 0 END`;

    const [results, totalResult] = await Promise.all([
      db
        .select(ingredientColumns)
        .from(ingredients)
        .where(whereClause)
        .orderBy(desc(isExactMatch), desc(isStartsWith), asc(ingredients.name))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: sql<number>`count(*)` })
        .from(ingredients)
        .where(whereClause),
    ]);

    const total = Number(totalResult[0]?.value ?? 0);

    // Fallback to vector search if text search yielded nothing and query exists
    if (total === 0 && cleanQuery && cleanQuery !== "%" && !autosuggest) {
      return this.searchIngredientsVector(cleanQuery, options);
    }

    const finalResults =
      includeProducts && results.length > 0
        ? await this.attachProducts(results)
        : results;

    return {
      results: finalResults,
      page,
      totalPages: Math.ceil(total / limit) || 0,
      total,
    };
  }

  async getIngredientById(id: string, includeProducts: boolean = false) {
    const pgId = toPgId(id);

    const rows = await db
      .select(ingredientColumns)
      .from(ingredients)
      .where(eq(ingredients.id, pgId))
      .limit(1);

    if (rows.length === 0) return null;

    let ingredientData = rows[0] as any;

    if (includeProducts) {
      const withProducts = await this.attachProducts([ingredientData]);
      ingredientData = withProducts[0];
    }

    if (ingredientData.fdcId) {
      const nutRow = await db
        .select()
        .from(usdaFoods)
        .where(eq(usdaFoods.fdcId, ingredientData.fdcId))
        .limit(1);
      if (nutRow.length > 0) {
        ingredientData.nutrition = nutRow[0];
      }
    }

    return ingredientData;
  }

  async getIngredientPrices(ingredientId: string) {
    let pgId: string;
    try {
      pgId = toPgId(ingredientId);
    } catch {
      return null;
    }

    const ing = await db.query.ingredients.findFirst({
      where: eq(ingredients.id, pgId),
      columns: { id: true, name: true },
    });

    if (!ing) return null;

    const resolution = await this.graphTraversalService.resolveByIngredientId(pgId);
    if (!resolution) {
      return {
        ingredient: ing.name,
        ingredientId: ing.id,
        products: [],
        prices: [],
      };
    }

    return {
      ingredient: ing.name,
      ingredientId: ing.id,
      density: resolution.density ?? 1.0,
      products: resolution.products,
      prices: resolution.products,
      categories: resolution.categories,
      resolvedFrom: resolution.sourceIngredient
        ? {
            id: resolution.sourceIngredient.id,
            ingredient: resolution.sourceIngredient.name,
            relation: resolution.relation,
            level: resolution.level,
            derivative: resolution.derivative,
          }
        : resolution.relation === "child"
          ? {
              relation: "child",
              ingredient: ing.name,
            }
          : undefined,
    };
  }

  async fetchIngredientsByIds(ids: string[]) {
    if (ids.length === 0) return { ingredients: [], total: 0 };
    const pgIds = ids.map((id) => toPgId(id));
    const rows = await db
      .select(ingredientColumns)
      .from(ingredients)
      .where(inArray(ingredients.id, pgIds));
    return { ingredients: rows, total: rows.length };
  }

  async addIngredient(data: any) {
    const name = data.name?.trim();
    if (!name) throw new Error("Ingredient name is required");

    let embedding: number[] | null = null;
    try {
      embedding = await this.embedText(name);
    } catch (err: any) {
      console.warn(`Embedding generation skipped for "${name}":`, err?.message || err);
    }

    const photoUrl = data.photo?.trim();

    const [created] = await db
      .insert(ingredients)
      .values({
        name,
        aliases: Array.isArray(data.aliases) ? data.aliases : [],
        country: Array.isArray(data.country) ? data.country : [],
        cuisine: Array.isArray(data.cuisine) ? data.cuisine : [],
        region: Array.isArray(data.region) ? data.region : [],
        flavorProfile: Array.isArray(data.flavor_profile)
          ? data.flavor_profile
          : [],
        dietaryFlags: Array.isArray(data.dietary_flags)
          ? data.dietary_flags
          : [],
        provenance: data.provenance?.trim() || "MISSING",
        comment: data.comment?.trim() || null,
        pronunciation: data.pronunciation?.trim() || null,
        image: photoUrl ? { url: photoUrl, missing: false } : { missing: true },
        derivatives: Array.isArray(data.derivatives) ? data.derivatives : [],
        embedding,
      })
      .returning();

    if (created?.id) {
      this.enhanceIngredients([created.id]).catch((err) =>
        console.warn(`Background AI culinary enrichment failed for "${name}":`, err?.message || err)
      );
      if (!photoUrl) {
        this.enhanceIngredientImage(created.id).catch((err) =>
          console.warn(`Background image waterfall failed for "${name}":`, err?.message || err)
        );
      }
    }

    return created;
  }

  private mergeStringArrays(
    targetArr?: string[] | null,
    sourceArr?: string[] | null,
    extraItems: string[] = [],
    excludeLower?: string,
  ): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];

    for (const item of [
      ...(targetArr || []),
      ...(sourceArr || []),
      ...extraItems,
    ]) {
      const trimmed = item?.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (excludeLower && lower === excludeLower) continue;
      if (!seen.has(lower)) {
        seen.add(lower);
        merged.push(trimmed);
      }
    }

    return merged;
  }

  private mergeLinkArrays(
    targetArr: IngredientLink[] | null | undefined,
    sourceArr: IngredientLink[] | null | undefined,
    excludeIds: Set<string> = new Set(),
    excludeNameLower?: string,
  ): IngredientLink[] {
    const seen = new Set<string>();
    const merged: IngredientLink[] = [];

    for (const item of [...(targetArr || []), ...(sourceArr || [])]) {
      if (!item) continue;
      const trimmedName = item.name?.trim();
      const id = item.id ?? null;
      if (!trimmedName && !id) continue;
      if (id && excludeIds.has(id)) continue;
      const lower = (trimmedName || "").toLowerCase();
      if (excludeNameLower && lower === excludeNameLower) continue;
      const key = id ? `id:${id}` : `name:${lower}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push({ id, name: trimmedName || id! });
      }
    }

    return merged;
  }

  private getSingularCandidates(low: string): string[] {
    const candidates: string[] = [];
    if (low.endsWith("ies") && low.length > 4) {
      candidates.push(low.slice(0, -3) + "y");
    }
    if (low.endsWith("es") && low.length > 3) {
      candidates.push(low.slice(0, -2));
    }
    if (low.endsWith("s") && low.length > 2) {
      candidates.push(low.slice(0, -1));
    }
    return candidates;
  }

  private async lookupIngredientsByNamesOrAliases(
    rawNames: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const result = new Map<string, { id: string; name: string }>();
    const uniqueInputs = Array.from(
      new Set(rawNames.map((n) => n.trim().toLowerCase()).filter(Boolean)),
    );
    if (uniqueInputs.length === 0) return result;

    const allNameCandidates = new Set<string>(uniqueInputs);
    for (const low of uniqueInputs) {
      for (const c of this.getSingularCandidates(low)) {
        allNameCandidates.add(c);
      }
    }

    const byNameRows = await db
      .select({ id: ingredients.id, name: ingredients.name })
      .from(ingredients)
      .where(
        inArray(sql`lower(${ingredients.name})`, Array.from(allNameCandidates)),
      );

    const exactNameMap = new Map<string, { id: string; name: string }>();
    for (const r of byNameRows) {
      exactNameMap.set(r.name.trim().toLowerCase(), { id: r.id, name: r.name });
    }

    const remainingForAlias: string[] = [];
    for (const low of uniqueInputs) {
      if (exactNameMap.has(low)) {
        result.set(low, exactNameMap.get(low)!);
      } else {
        const singularMatch = this.getSingularCandidates(low).find((c) =>
          exactNameMap.has(c),
        );
        if (singularMatch) {
          result.set(low, exactNameMap.get(singularMatch)!);
        } else {
          remainingForAlias.push(low);
        }
      }
    }

    if (remainingForAlias.length > 0) {
      const aliasListSql = sql.join(
        remainingForAlias.map((a) => sql`${a}`),
        sql`, `,
      );
      const aliasRows = await db
        .select({
          id: ingredients.id,
          name: ingredients.name,
          aliases: ingredients.aliases,
        })
        .from(ingredients)
        .where(
          sql`EXISTS (SELECT 1 FROM unnest(${ingredients.aliases}) a WHERE lower(trim(a)) IN (${aliasListSql}))`,
        );

      const aliasMap = new Map<string, { id: string; name: string }>();
      for (const r of aliasRows) {
        for (const a of r.aliases || []) {
          const aLow = String(a || "").trim().toLowerCase();
          if (aLow && !aliasMap.has(aLow)) {
            aliasMap.set(aLow, { id: r.id, name: r.name });
          }
        }
      }

      for (const low of remainingForAlias) {
        if (aliasMap.has(low)) {
          result.set(low, aliasMap.get(low)!);
        }
      }
    }

    return result;
  }

  private async resolveIngredientLinks(
    links: IngredientLink[],
  ): Promise<IngredientLink[]> {
    if (!links || links.length === 0) return [];

    const idsToLookup = links
      .filter((l) => l.id && (!l.name || l.name === l.id))
      .map((l) => toPgId(l.id!));
    const namesToLookup = links
      .filter((l) => !l.id && l.name?.trim())
      .map((l) => l.name.trim().toLowerCase());

    const idToName = new Map<string, string>();
    if (idsToLookup.length > 0) {
      const rows = await db
        .select({ id: ingredients.id, name: ingredients.name })
        .from(ingredients)
        .where(inArray(ingredients.id, idsToLookup));
      for (const r of rows) {
        idToName.set(r.id, r.name);
      }
    }

    const nameToId = await this.lookupIngredientsByNamesOrAliases(namesToLookup);

    const seen = new Set<string>();
    const resolved: IngredientLink[] = [];
    for (const link of links) {
      const trimmed = (link.name || "").trim();
      let id = link.id ? toPgId(link.id) : null;
      let name = trimmed;

      if (id && idToName.has(id)) {
        name = idToName.get(id)!;
      } else if (!id && trimmed) {
        const found = nameToId.get(trimmed.toLowerCase());
        if (found) {
          id = found.id;
          name = found.name;
        }
      }

      if (!name && !id) continue;
      const key = id ? `id:${id}` : `name:${name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        resolved.push({ id, name: name || id! });
      }
    }

    return resolved;
  }

  private async resolveDerivativeTargetIds(
    derivs: DerivativeItem[],
  ): Promise<DerivativeItem[]> {
    if (!derivs || derivs.length === 0) return [];
    const namesToLookup = derivs
      .filter((d) => !d.targetId && d.name?.trim())
      .map((d) => d.name.trim().toLowerCase());

    const nameToId = await this.lookupIngredientsByNamesOrAliases(namesToLookup);

    return derivs.map((d) => {
      if (!d.targetId && d.name?.trim()) {
        const found = nameToId.get(d.name.trim().toLowerCase());
        if (found) {
          return { ...d, targetId: found.id };
        }
      }
      return d;
    });
  }

  private async resolveIngredientRedirect(
    txOrDb: typeof db | any,
    id: string,
  ): Promise<{ targetId: string; wasMerged: boolean }> {
    let currentId = toPgId(id);
    const visited = new Set<string>([currentId]);
    let wasMerged = false;

    for (let hop = 0; hop < 5; hop++) {
      const [redirect] = await txOrDb
        .select({ targetId: ingredientRedirects.targetId })
        .from(ingredientRedirects)
        .where(eq(ingredientRedirects.sourceId, currentId))
        .limit(1);

      if (!redirect) {
        break;
      }

      wasMerged = true;
      if (visited.has(redirect.targetId)) {
        break;
      }
      visited.add(redirect.targetId);
      currentId = redirect.targetId;
    }

    return { targetId: currentId, wasMerged };
  }

  private parseExpectedVersion(raw: string | number): Date | "*" {
    if (typeof raw === "number") {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException("Invalid expectedUpdatedAt timestamp");
      }
      return parsed;
    }

    let cleaned = raw.trim();
    if (cleaned === "*") {
      return "*";
    }
    if (cleaned.startsWith("W/")) {
      cleaned = cleaned.slice(2).trim();
    }
    if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    const asNum = Number(cleaned);
    const parsed =
      !Number.isNaN(asNum) && /^\d+$/.test(cleaned)
        ? new Date(asNum)
        : new Date(cleaned);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        "Invalid If-Match or expectedUpdatedAt timestamp",
      );
    }
    return parsed;
  }

  async updateIngredient(id: string, data: any, ifMatch?: string) {
    const pgId = toPgId(id);
    const { expectedUpdatedAt, ...rest } = data;
    const rawVersion = ifMatch ?? expectedUpdatedAt;

    if (rawVersion === undefined || rawVersion === null || rawVersion === "") {
      throw new HttpException(
        "If-Match header or expectedUpdatedAt field is required",
        HttpStatus.PRECONDITION_REQUIRED,
      );
    }

    const expectedDate = this.parseExpectedVersion(rawVersion);

    const payload: Record<string, any> = { ...rest };
    if (Array.isArray(payload.partOf)) {
      payload.partOf = await this.resolveIngredientLinks(payload.partOf);
    }
    if (Array.isArray(payload.varieties)) {
      payload.varieties = await this.resolveIngredientLinks(payload.varieties);
    }
    if (Array.isArray(payload.substitutes)) {
      payload.substitutes = await this.resolveIngredientLinks(
        payload.substitutes,
      );
    }
    if (Array.isArray(payload.pairsWith)) {
      payload.pairsWith = await this.resolveIngredientLinks(payload.pairsWith);
    }
    if (Array.isArray(payload.derivatives)) {
      payload.derivatives = await this.resolveDerivativeTargetIds(
        payload.derivatives,
      );
    }

    const now = new Date();
    const whereCondition =
      expectedDate === "*"
        ? eq(ingredients.id, pgId)
        : and(
            eq(ingredients.id, pgId),
            sql`date_trunc('milliseconds', ${ingredients.updatedAt}) = date_trunc('milliseconds', ${expectedDate.toISOString()}::timestamptz)`,
          );

    try {
      const [updated] = await db
        .update(ingredients)
        .set({
          ...payload,
          lastModified: now,
          updatedAt: now,
        })
        .where(whereCondition)
        .returning();

      if (updated) {
        return updated;
      }

      const [existing] = await db
        .select({ id: ingredients.id, updatedAt: ingredients.updatedAt })
        .from(ingredients)
        .where(eq(ingredients.id, pgId))
        .limit(1);

      if (existing) {
        throw new ConflictException({
          message: "Ingredient was modified concurrently; re-fetch and retry",
          currentUpdatedAt: existing.updatedAt,
        });
      }

      const redirect = await this.resolveIngredientRedirect(db, pgId);
      if (redirect.wasMerged) {
        throw new ConflictException({
          message: `Ingredient ${pgId} was merged into ${redirect.targetId}`,
          mergedInto: redirect.targetId,
        });
      }

      return null;
    } catch (err: any) {
      if (err?.code === "23503") {
        throw new BadRequestException(
          "Referenced fdcId does not exist in usda_foods",
        );
      }
      if (err?.code === "23505") {
        throw new BadRequestException(
          "An ingredient with that name already exists",
        );
      }
      throw err;
    }
  }

  private async atomicLinkRelation(
    id: string,
    field: "varieties" | "partOf",
    input: { targetId?: string; name?: string },
  ) {
    const pgId = toPgId(id);

    return db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, pgId))
        .for("update")
        .limit(1);

      if (!parent) {
        const redirect = await this.resolveIngredientRedirect(tx, pgId);
        if (redirect.wasMerged) {
          throw new ConflictException({
            message: `Ingredient ${pgId} was merged into ${redirect.targetId}`,
            mergedInto: redirect.targetId,
          });
        }
        throw new NotFoundException(`Ingredient ${id} not found`);
      }

      let linkToAdd: IngredientLink;
      if (input.targetId) {
        const resolved = await this.resolveIngredientRedirect(tx, input.targetId);
        const [target] = await tx
          .select({ id: ingredients.id, name: ingredients.name })
          .from(ingredients)
          .where(eq(ingredients.id, resolved.targetId))
          .limit(1);

        if (!target) {
          throw new NotFoundException(
            `Target ingredient ${input.targetId} not found`,
          );
        }
        linkToAdd = { id: target.id, name: target.name };
      } else if (input.name) {
        const [resolvedLink] = await this.resolveIngredientLinks([
          { id: null, name: input.name.trim() },
        ]);
        linkToAdd = resolvedLink;
      } else {
        throw new BadRequestException("Target ID or name is required");
      }

      const currentLinks = ((parent[field] as IngredientLink[] | null) || []).slice();
      const targetNameLower = linkToAdd.name.trim().toLowerCase();
      const alreadyExists = currentLinks.some(
        (item) =>
          (linkToAdd.id && item.id === linkToAdd.id) ||
          item.name.trim().toLowerCase() === targetNameLower,
      );

      if (alreadyExists) {
        return { added: false, ingredient: parent };
      }

      const nextLinks = [...currentLinks, linkToAdd];
      const now = new Date();
      const [updated] = await tx
        .update(ingredients)
        .set({
          [field]: nextLinks,
          lastModified: now,
          updatedAt: now,
        })
        .where(eq(ingredients.id, pgId))
        .returning();

      return { added: true, ingredient: updated };
    });
  }

  private async atomicUnlinkRelation(
    id: string,
    field: "varieties" | "partOf",
    targetId: string,
  ) {
    const pgId = toPgId(id);
    const targetPgId = toPgId(targetId);

    return db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, pgId))
        .for("update")
        .limit(1);

      if (!parent) {
        const redirect = await this.resolveIngredientRedirect(tx, pgId);
        if (redirect.wasMerged) {
          throw new ConflictException({
            message: `Ingredient ${pgId} was merged into ${redirect.targetId}`,
            mergedInto: redirect.targetId,
          });
        }
        throw new NotFoundException(`Ingredient ${id} not found`);
      }

      const resolvedTarget = await this.resolveIngredientRedirect(tx, targetPgId);
      const idsToRemove = new Set([targetPgId, resolvedTarget.targetId]);

      const currentLinks = (parent[field] as IngredientLink[] | null) || [];
      const nextLinks = currentLinks.filter(
        (item) => !item.id || !idsToRemove.has(item.id),
      );

      if (nextLinks.length === currentLinks.length) {
        return { removed: false, ingredient: parent };
      }

      const now = new Date();
      const [updated] = await tx
        .update(ingredients)
        .set({
          [field]: nextLinks,
          lastModified: now,
          updatedAt: now,
        })
        .where(eq(ingredients.id, pgId))
        .returning();

      return { removed: true, ingredient: updated };
    });
  }

  async linkVariety(
    id: string,
    input: { varietyId?: string; id?: string; name?: string },
  ) {
    return this.atomicLinkRelation(id, "varieties", {
      targetId: input.varietyId ?? input.id,
      name: input.name,
    });
  }

  async unlinkVariety(id: string, varietyId: string) {
    return this.atomicUnlinkRelation(id, "varieties", varietyId);
  }

  async linkPartOf(
    id: string,
    input: { parentId?: string; id?: string; name?: string },
  ) {
    return this.atomicLinkRelation(id, "partOf", {
      targetId: input.parentId ?? input.id,
      name: input.name,
    });
  }

  async unlinkPartOf(id: string, parentId: string) {
    return this.atomicUnlinkRelation(id, "partOf", parentId);
  }

  async claimIngredients(options: {
    limit?: number;
    claimMinutes?: number;
    reviewStatus?: string;
    provenance?: string;
  }) {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const claimMinutes = Math.min(Math.max(options.claimMinutes ?? 10, 1), 120);

    const filterConditions: SQL[] = [
      sql`(${ingredients.claimedUntil} IS NULL OR ${ingredients.claimedUntil} < NOW())`,
    ];

    if (options.reviewStatus === "unreviewed") {
      filterConditions.push(isNull(ingredients.reviewStatus));
    } else if (options.reviewStatus) {
      filterConditions.push(eq(ingredients.reviewStatus, options.reviewStatus));
    }
    if (options.provenance) {
      filterConditions.push(eq(ingredients.provenance, options.provenance));
    }

    const whereClause = and(...filterConditions);

    const rows = await db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(whereClause)
        .orderBy(asc(ingredients.updatedAt))
        .for("update", { skipLocked: true })
        .limit(limit);

      if (candidates.length === 0) {
        return [];
      }

      const ids = candidates.map((c) => c.id);
      const claimExpiry = new Date(Date.now() + claimMinutes * 60 * 1000);

      return tx
        .update(ingredients)
        .set({ claimedUntil: claimExpiry })
        .where(inArray(ingredients.id, ids))
        .returning(ingredientColumns);
    });

    return {
      ingredients: rows,
      count: rows.length,
      claimMinutes,
    };
  }

  async mergeIngredients(
    sourceId: string,
    targetId: string,
    addSourceNameAsAlias = true,
  ) {
    const sourcePgId = toPgId(sourceId);
    const targetPgId = toPgId(targetId);

    if (sourcePgId === targetPgId) {
      throw new BadRequestException("sourceId and targetId must be different");
    }

    return db.transaction(async (tx) => {
      // Lock both rows in deterministic UUID order to prevent deadlocks
      const lockedRows = await tx
        .select()
        .from(ingredients)
        .where(inArray(ingredients.id, [sourcePgId, targetPgId]))
        .orderBy(asc(ingredients.id))
        .for("update");

      const source = lockedRows.find((r) => r.id === sourcePgId);
      const target = lockedRows.find((r) => r.id === targetPgId);

      if (!source) {
        const redirect = await this.resolveIngredientRedirect(tx, sourcePgId);
        if (redirect.wasMerged) {
          throw new ConflictException({
            message: `Source ingredient ${sourceId} was already merged into ${redirect.targetId}`,
            mergedInto: redirect.targetId,
          });
        }
        throw new NotFoundException(`Source ingredient ${sourceId} not found`);
      }

      if (!target) {
        const redirect = await this.resolveIngredientRedirect(tx, targetPgId);
        if (redirect.wasMerged) {
          throw new ConflictException({
            message: `Target ingredient ${targetId} was merged into ${redirect.targetId}`,
            mergedInto: redirect.targetId,
          });
        }
        throw new NotFoundException(`Target ingredient ${targetId} not found`);
      }

      const targetNameLower = target.name.trim().toLowerCase();
      const extraAliases = addSourceNameAsAlias ? [source.name] : [];

      const mergedAliases = this.mergeStringArrays(
        target.aliases,
        source.aliases,
        extraAliases,
        targetNameLower,
      );
      const excludeIds = new Set<string>([sourcePgId, targetPgId]);
      const mergedPartOf = this.mergeLinkArrays(
        target.partOf,
        source.partOf,
        excludeIds,
        targetNameLower,
      );
      const mergedVarieties = this.mergeLinkArrays(
        target.varieties,
        source.varieties,
        excludeIds,
        targetNameLower,
      );
      const mergedUsedIn = this.mergeStringArrays(target.usedIn, source.usedIn);
      const mergedSubstitutes = this.mergeLinkArrays(
        target.substitutes,
        source.substitutes,
        excludeIds,
        targetNameLower,
      );
      const mergedPairsWith = this.mergeLinkArrays(
        target.pairsWith,
        source.pairsWith,
        excludeIds,
        targetNameLower,
      );
      const mergedFlavorProfile = this.mergeStringArrays(
        target.flavorProfile,
        source.flavorProfile,
      );
      const mergedDietaryFlags = this.mergeStringArrays(
        target.dietaryFlags,
        source.dietaryFlags,
      );
      const mergedCountry = this.mergeStringArrays(
        target.country,
        source.country,
      );
      const mergedCuisine = this.mergeStringArrays(
        target.cuisine,
        source.cuisine,
      );
      const mergedRegion = this.mergeStringArrays(target.region, source.region);

      // Merge derivatives by lowercase name
      const derivSeen = new Set<string>();
      const mergedDerivatives = [
        ...(target.derivatives || []),
        ...(source.derivatives || []),
      ].filter((d) => {
        const key = d?.name?.trim().toLowerCase();
        if (!key || derivSeen.has(key)) return false;
        derivSeen.add(key);
        return true;
      });

      const mergedImage =
        target.image && target.image.missing === false
          ? target.image
          : source.image && source.image.missing === false
            ? source.image
            : target.image || source.image;

      const [updatedTarget] = await tx
        .update(ingredients)
        .set({
          aliases: mergedAliases,
          partOf: mergedPartOf,
          varieties: mergedVarieties,
          usedIn: mergedUsedIn,
          substitutes: mergedSubstitutes,
          pairsWith: mergedPairsWith,
          flavorProfile: mergedFlavorProfile,
          dietaryFlags: mergedDietaryFlags,
          country: mergedCountry,
          cuisine: mergedCuisine,
          region: mergedRegion,
          derivatives: mergedDerivatives,
          comment: target.comment || source.comment,
          pronunciation: target.pronunciation || source.pronunciation,
          density: target.density ?? source.density,
          fdcId: target.fdcId ?? source.fdcId,
          image: mergedImage,
          updatedAt: new Date(),
        })
        .where(eq(ingredients.id, targetPgId))
        .returning();

      // Reassign any product mappings referencing sourcePgId -> targetPgId
      const affectedMappings = await tx
        .select({
          id: mappings.id,
          matchedIngredients: mappings.matchedIngredients,
        })
        .from(mappings)
        .where(sql`${sourcePgId} = ANY(${mappings.matchedIngredients})`);

      let mappingsUpdated = 0;
      for (const m of affectedMappings) {
        const nextIds = Array.from(
          new Set(
            (m.matchedIngredients || []).map((uid) =>
              uid === sourcePgId ? targetPgId : uid,
            ),
          ),
        );
        await tx
          .update(mappings)
          .set({
            matchedIngredients: nextIds,
            updatedAt: new Date(),
          })
          .where(eq(mappings.id, m.id));
        mappingsUpdated++;
      }

      // Reassign any existing redirects that pointed to sourcePgId -> targetPgId
      await tx
        .update(ingredientRedirects)
        .set({ targetId: targetPgId, mergedAt: new Date() })
        .where(eq(ingredientRedirects.targetId, sourcePgId));

      // Record redirect for sourcePgId -> targetPgId before deleting source
      await tx
        .insert(ingredientRedirects)
        .values({
          sourceId: sourcePgId,
          targetId: targetPgId,
          sourceName: source.name,
        })
        .onConflictDoUpdate({
          target: ingredientRedirects.sourceId,
          set: {
            targetId: targetPgId,
            sourceName: source.name,
            mergedAt: new Date(),
          },
        });

      await tx.delete(ingredients).where(eq(ingredients.id, sourcePgId));

      await tx.insert(auditLogs).values({
        type: "INGREDIENT_MERGE",
        tag: "gap_filler",
        status: "completed",
        initiatedBy: "admin_api",
        message: `Merged "${source.name}" (${sourcePgId}) into "${target.name}" (${targetPgId})`,
        metadata: {
          sourceId: sourcePgId,
          sourceName: source.name,
          targetId: targetPgId,
          targetName: target.name,
          mappingsUpdated,
        },
        endTime: new Date(),
      });

      return {
        mergedInto: updatedTarget,
        deletedSourceId: sourcePgId,
        deletedSourceName: source.name,
        mappingsUpdated,
      };
    });
  }

  async deleteIngredient(id: string) {
    const pgId = toPgId(id);
    const [deleted] = await db
      .delete(ingredients)
      .where(eq(ingredients.id, pgId))
      .returning();

    return deleted || null;
  }

  async getBestIngredientMatch(query: string) {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { match: null, confidence: 0 };
    }

    const cached = await db
      .select({ embedding: queryEmbeddings.embedding })
      .from(queryEmbeddings)
      .where(eq(queryEmbeddings.query, cleanQuery))
      .limit(1);

    let queryVector: number[];
    if (cached.length > 0) {
      queryVector = cached[0].embedding as number[];
    } else {
      queryVector = await this.embedText(cleanQuery);
      await db.insert(queryEmbeddings).values({
        query: cleanQuery,
        embedding: queryVector,
      });
    }

    const similarity = sql<number>`1 - (${cosineDistance(ingredients.embedding, queryVector)})`;
    const results = await db
      .select({
        name: ingredients.name,
        score: similarity,
      })
      .from(ingredients)
      .orderBy(desc(similarity))
      .limit(1);

    if (results.length === 0) {
      return { match: null, confidence: 0 };
    }

    const best = results[0];
    const confidence = Math.min(Math.max(Number(best.score), 0), 1);
    return {
      match: best.name,
      confidence,
    };
  }

  async enhanceIngredients(ids: string[]): Promise<Record<string, any>> {
    if (!ids.length) return {};

    const pgIds = ids.map((id) => toPgId(id));
    const fetched = await db
      .select()
      .from(ingredients)
      .where(inArray(ingredients.id, pgIds));

    if (!fetched.length) return {};

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY not configured for enhancement");
      return {};
    }

    const ai = new GoogleGenAI({ apiKey });
    const enrichedMap: Record<string, any> = {};

    let logId: string | null = null;
    try {
      const [log] = await db
        .insert(auditLogs)
        .values({
          type: "AI_ENRICHMENT",
          tag: "GEMINI_FLASH",
          initiatedBy: "user",
          status: "pending",
          metadata: { ingredientIds: ids, count: ids.length, step: "starting" },
        })
        .returning({ id: auditLogs.id });
      logId = log?.id ?? null;
    } catch {
      // Audit log non-critical
    }

    try {
      for (const ing of fetched) {
        const prompt = `Provide detailed enrichment for the ingredient: "${ing.name}".
Return JSON with:
- id: "${ing.id}"
- name: "${ing.name}"
- aliases: array of alternative names
- country, cuisine, region, flavorProfile, dietaryFlags as arrays of strings
- comment: a string description of what the ingredient is, how it's used in cooking, where it's from, how it can be stored
- pronunciation: standard format for pronunciation
- derivatives: array of derivative items produced from this ingredient, where each object has:
  * name: name of derivative (e.g. "pumpkin puree")
  * process: culinary transformation method (e.g. "steamed, peeled, and pureed")
  * yieldRatio: numeric ratio (0 to 1) of derivative mass to raw base mass (e.g. 0.70)
  * lossRatio: numeric ratio (0 to 1) of waste/moisture lost (e.g. 0.30)
Use valid JSON only.`;

        const response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL || "gemini-flash-latest",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });

        if (response.text) {
          const enriched = JSON.parse(response.text);
          enrichedMap[ing.id] = enriched;

          let updatedDerivatives = Array.isArray(ing.derivatives)
            ? [...(ing.derivatives as any[])]
            : [];
          if (
            Array.isArray(enriched.derivatives) &&
            enriched.derivatives.length > 0
          ) {
            const mapByName = new Map<string, any>();
            for (const d of updatedDerivatives) {
              const dName = (
                typeof d === "string" ? d : d?.name || ""
              )
                .toLowerCase()
                .trim();
              if (dName)
                mapByName.set(dName, typeof d === "string" ? { name: d } : d);
            }
            for (const d of enriched.derivatives) {
              const rawName = (
                typeof d === "string" ? d : d?.name || ""
              ).trim();
              if (!rawName) continue;
              const key = rawName.toLowerCase();
              const existing = mapByName.get(key);
              const structured = typeof d === "string" ? { name: rawName } : d;
              mapByName.set(key, {
                name: rawName,
                targetId: structured.targetId ?? existing?.targetId ?? null,
                process: structured.process ?? existing?.process ?? null,
                yieldRatio:
                  typeof structured.yieldRatio === "number"
                    ? structured.yieldRatio
                    : existing?.yieldRatio ?? null,
                lossRatio:
                  typeof structured.lossRatio === "number"
                    ? structured.lossRatio
                    : existing?.lossRatio ?? null,
              });
            }
            updatedDerivatives = Array.from(mapByName.values());
          }

          const enrichedSubs = (enriched.substitutes || []).map((s: any) =>
            typeof s === "string"
              ? { id: null, name: s.trim() }
              : { id: s?.id ?? null, name: String(s?.name || "").trim() },
          );
          const mergedSubs = await this.resolveIngredientLinks(
            this.mergeLinkArrays(ing.substitutes || [], enrichedSubs),
          );

          const updateData: any = {
            aliases: mergeArrays(ing.aliases || [], enriched.aliases || []),
            country: mergeArrays(ing.country || [], enriched.country || []),
            cuisine: mergeArrays(ing.cuisine || [], enriched.cuisine || []),
            region: mergeArrays(ing.region || [], enriched.region || []),
            flavorProfile: mergeArrays(
              ing.flavorProfile || [],
              enriched.flavorProfile || [],
            ),
            dietaryFlags: mergeArrays(
              ing.dietaryFlags || [],
              enriched.dietaryFlags || [],
            ),
            substitutes: mergedSubs,
            derivatives: updatedDerivatives,
            comment: enriched.comment || ing.comment || null,
            pronunciation: enriched.pronunciation || ing.pronunciation || null,
            lastModified: new Date(),
            updatedAt: new Date(),
          };

          if (enriched.photo) {
            updateData.image = {
              url: enriched.photo,
              source: "Gemini",
              missing: false,
            };
          }

          await db
            .update(ingredients)
            .set(updateData)
            .where(eq(ingredients.id, ing.id));
        }
      }

      if (logId) {
        await db
          .update(auditLogs)
          .set({
            status: "completed",
            message: `Successfully enriched ${ids.length} ingredient(s).`,
            metadata: {
              ingredientIds: ids,
              count: ids.length,
              step: "completed",
            },
            endTime: new Date(),
          })
          .where(eq(auditLogs.id, logId));
      }

      return enrichedMap;
    } catch (err: any) {
      if (logId) {
        await db
          .update(auditLogs)
          .set({
            status: "failed",
            error: err.message || String(err),
            metadata: { ingredientIds: ids, count: ids.length, step: "failed" },
            endTime: new Date(),
          })
          .where(eq(auditLogs.id, logId));
      }
      throw err;
    }
  }

  async enhanceIngredientImage(id: string): Promise<any | null> {
    const pgId = toPgId(id);
    const [ingredient] = await db
      .select({ id: ingredients.id, name: ingredients.name })
      .from(ingredients)
      .where(eq(ingredients.id, pgId))
      .limit(1);

    if (!ingredient) {
      throw new NotFoundException(`Ingredient with ID ${id} not found`);
    }

    let logId: string | null = null;
    try {
      const [log] = await db
        .insert(auditLogs)
        .values({
          type: "SYSTEM_FETCH",
          tag: "IMAGE_WATERFALL_CULINARY_SCORED",
          initiatedBy: "admin",
          status: "pending",
          metadata: { ingredientId: pgId, ingredientName: ingredient.name },
        })
        .returning({ id: auditLogs.id });
      logId = log?.id ?? null;
    } catch {
      // Audit log non-critical
    }

    try {
      const imageResult =
        await this.imageWaterfallService.fetchBestCulinaryImage(
          ingredient.name,
        );

      if (!imageResult) {
        if (logId) {
          await db
            .update(auditLogs)
            .set({
              status: "completed",
              message: `Culinary scoring waterfall exhausted. No photo found for "${ingredient.name}".`,
              metadata: {
                ingredientId: pgId,
                ingredientName: ingredient.name,
                status: "no_results",
              },
              endTime: new Date(),
            })
            .where(eq(auditLogs.id, logId));
        }
        return null;
      }

      const [updated] = await db
        .update(ingredients)
        .set({
          image: {
            url: imageResult.url,
            author: imageResult.author,
            source: imageResult.source,
            missing: false,
          },
          updatedAt: new Date(),
        })
        .where(eq(ingredients.id, pgId))
        .returning();

      if (logId) {
        await db
          .update(auditLogs)
          .set({
            status: "completed",
            message: `Mapped high-score culinary image via ${imageResult.source}`,
            metadata: {
              ingredientId: pgId,
              ingredientName: ingredient.name,
              sourceUsed: imageResult.source,
              imageUrl: imageResult.url,
            },
            endTime: new Date(),
          })
          .where(eq(auditLogs.id, logId));
      }

      return updated;
    } catch (err: any) {
      if (logId) {
        await db
          .update(auditLogs)
          .set({
            status: "failed",
            error: err.message || String(err),
            endTime: new Date(),
          })
          .where(eq(auditLogs.id, logId));
      }
      throw err;
    }
  }
}

function mergeArrays(existing: any[] = [], incoming: any[] = []): string[] {
  const set = new Set<string>();
  const result: string[] = [];
  for (const item of [...(existing || []), ...(incoming || [])]) {
    if (!item) continue;
    let str = "";
    if (typeof item === "string") {
      str = item.trim();
    } else if (typeof item === "object") {
      const extracted =
        (item as any).alias ||
        (item as any).name ||
        (item as any).value ||
        (item as any).text;
      if (typeof extracted === "string") str = extracted.trim();
    }
    if (
      str &&
      str !== "[object Object]" &&
      !str.includes("[object Object]") &&
      !set.has(str.toLowerCase())
    ) {
      set.add(str.toLowerCase());
      result.push(str);
    }
  }
  return result;
}

