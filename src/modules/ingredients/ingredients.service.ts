import { Injectable, NotFoundException } from "@nestjs/common";
import { GoogleGenAI } from "@google/genai";
import { db } from "@/database/database.module";
import {
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
  sql,
  type SQL,
} from "drizzle-orm";
import { toPgId } from "@/common/utils/uuid.util";
import { ImageWaterfallService } from "./image-waterfall.service";

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

const EMBEDDING_DIMENSIONS = 1536;
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
  fdcId: ingredients.fdcId,
  lastModified: ingredients.lastModified,
  createdAt: ingredients.createdAt,
  updatedAt: ingredients.updatedAt,
};

@Injectable()
export class IngredientsService {
  private ai: GoogleGenAI | null = null;

  constructor(private readonly imageWaterfallService: ImageWaterfallService) {
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
    return response.embeddings![0].values as number[];
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
      .where(sql`${ingredients.partOf} @> ARRAY[${rootNameLower}]::text[]`);

    for (const c of partOfChildren) {
      visited.add(c.id);
    }

    if (root.varieties && root.varieties.length > 0) {
      const varietyNames = root.varieties
        .filter(Boolean)
        .map((v) => v.trim().toLowerCase());
      if (varietyNames.length > 0) {
        const varietyChildren = await db
          .select({ id: ingredients.id })
          .from(ingredients)
          .where(inArray(ingredients.name, varietyNames));

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
    const pgId = toPgId(ingredientId);

    const ing = await db.query.ingredients.findFirst({
      where: eq(ingredients.id, pgId),
      columns: { id: true, name: true, partOf: true, varieties: true },
    });

    if (!ing) return null;

    const fetchProductsForIngredients = async (targetPgIds: string[]) => {
      if (!targetPgIds || targetPgIds.length === 0) return [];

      const mapped = await db
        .select({
          product: products,
          source: priceSources,
          matchedIngredients: mappings.matchedIngredients,
        })
        .from(mappings)
        .innerJoin(products, eq(products.id, mappings.productId))
        .leftJoin(priceSources, eq(priceSources.id, products.sourceId))
        .where(
          sql`${mappings.matchedIngredients} && ARRAY[${sql.join(
            targetPgIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]`,
        );

      if (mapped.length === 0) return [];

      const uniqueMappedMap = new Map<string, { product: ProductRow; source: any; matchedIngredients: string[] | null }>();
      for (const item of mapped) {
        if (!uniqueMappedMap.has(item.product.id)) {
          uniqueMappedMap.set(item.product.id, item);
        }
      }
      const uniqueMapped = Array.from(uniqueMappedMap.values());
      const productIds = uniqueMapped.map((m) => m.product.id);

      const latestPrices = await db
        .selectDistinctOn([priceHistories.productId], {
          productId: priceHistories.productId,
          latestPrice: priceHistories.price,
          currency: priceHistories.currency,
          lastUpdated: priceHistories.timestamp,
        })
        .from(priceHistories)
        .where(inArray(priceHistories.productId, productIds))
        .orderBy(priceHistories.productId, desc(priceHistories.timestamp));

      const priceMap = new Map(latestPrices.map((p) => [p.productId, p]));

      return uniqueMapped.map(({ product, source, matchedIngredients }) => {
        const latestData = priceMap.get(product.id);
        return {
          ...product,
          source,
          matchedIngredients,
          price: latestData ? latestData.latestPrice : product.price,
          currency: latestData ? latestData.currency : product.currency || "LKR",
          lastPriceUpdate: latestData ? latestData.lastUpdated : null,
        };
      });
    };

    const nameLower = ing.name.trim().toLowerCase();

    // 1. Direct products for this ingredient
    const directProducts = await fetchProductsForIngredients([pgId]);

    // 2. Parent category check: Does this ingredient have children in partOf?
    let childIngredients: { id: string; name: string }[] = [];
    if (ing.varieties && ing.varieties.length > 0) {
      childIngredients = await db
        .select({ id: ingredients.id, name: ingredients.name })
        .from(ingredients)
        .where(sql`${ingredients.partOf} @> ARRAY[${nameLower}]::text[]`);
    }

    // If this ingredient is a parent with children that have products:
    if (childIngredients.length > 0) {
      const childIds = childIngredients.map((c) => c.id);
      const childMap = new Map(childIngredients.map((c) => [c.id, c.name]));
      const allIds = [pgId, ...childIds];
      const allProducts = await fetchProductsForIngredients(allIds);

      if (allProducts.length > 0) {
        const categoryCounts = new Map<string, number>();
        const directName = `${ing.name} (Direct / Generic)`;

        const categorizedProducts = allProducts.map((p) => {
          const matchedChildId = (p as any).matchedIngredients?.find((id: string) => childMap.has(id));
          let categoryName = directName;
          let categoryId = pgId;

          if (matchedChildId) {
            categoryName = childMap.get(matchedChildId)!;
            categoryId = matchedChildId;
          }

          categoryCounts.set(categoryName, (categoryCounts.get(categoryName) || 0) + 1);

          return {
            ...p,
            childIngredient: {
              id: categoryId,
              name: categoryName,
            },
          };
        });

        const categories = [
          { id: "all", name: "All", count: categorizedProducts.length },
          ...Array.from(categoryCounts.entries())
            .map(([name, count]) => ({
              id: name,
              name,
              count,
            }))
            .sort((a, b) => b.count - a.count),
        ];

        return {
          ingredient: ing.name,
          ingredientId: ing.id,
          products: categorizedProducts,
          prices: categorizedProducts,
          categories,
        };
      }
    }

    // If viewing a child ingredient with direct products: return ONLY its direct products!
    if (directProducts.length > 0) {
      return {
        ingredient: ing.name,
        ingredientId: ing.id,
        products: directProducts,
        prices: directProducts,
      };
    }

    // 3. Fallback: Upward ancestor traversal (Immediate parent level 1 -> Grandparent level 2 -> ...)
    let currentParents = (ing.partOf || []).map((p) => p.trim().toLowerCase()).filter(Boolean);
    let level = 1;
    const visitedParents = new Set<string>([nameLower]);

    while (currentParents.length > 0 && level <= 4) {
      const nextParents: string[] = [];

      for (const parentName of currentParents) {
        if (visitedParents.has(parentName)) continue;
        visitedParents.add(parentName);

        const parentIng = await db.query.ingredients.findFirst({
          where: sql`LOWER(${ingredients.name}) = ${parentName}`,
          columns: { id: true, name: true, partOf: true },
        });

        if (parentIng) {
          const parentProducts = await fetchProductsForIngredients([parentIng.id]);
          if (parentProducts.length > 0) {
            return {
              ingredient: ing.name,
              ingredientId: ing.id,
              products: parentProducts,
              prices: parentProducts,
              resolvedFrom: {
                ingredient: parentIng.name,
                relation: level === 1 ? "parent" : "ancestor",
                level,
              },
            };
          }

          if (parentIng.partOf) {
            for (const gp of parentIng.partOf) {
              const cleanGp = gp.trim().toLowerCase();
              if (!visitedParents.has(cleanGp)) {
                nextParents.push(cleanGp);
              }
            }
          }
        }
      }

      currentParents = nextParents;
      level++;
    }

    return {
      ingredient: ing.name,
      ingredientId: ing.id,
      products: [],
      prices: [],
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
    const embedding = await this.embedText(name);

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
        comment: data.comment?.trim(),
        pronunciation: data.pronunciation?.trim(),
        image: data.photo?.trim()
          ? { url: data.photo.trim(), missing: false }
          : { missing: true },
        embedding,
      })
      .returning();

    return created;
  }

  async updateIngredient(id: string, data: any) {
    const pgId = toPgId(id);
    const [updated] = await db
      .update(ingredients)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(ingredients.id, pgId))
      .returning();

    return updated || null;
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
            substitutes: mergeArrays(
              ing.substitutes || [],
              enriched.substitutes || [],
            ),
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

