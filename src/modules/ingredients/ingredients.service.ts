import { Injectable } from "@nestjs/common";
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

  constructor() {
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
    const visited = new Set<string>();
    const queue: string[] = [rootId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const current = await db.query.ingredients.findFirst({
        where: eq(ingredients.id, toPgId(currentId)),
        columns: { id: true, name: true, varieties: true },
      });

      if (!current) continue;

      if (current.varieties && current.varieties.length > 0) {
        const varietyNames = current.varieties
          .filter(Boolean)
          .map((v) => v.trim().toLowerCase());
        if (varietyNames.length > 0) {
          const childRows = await db
            .select({ id: ingredients.id })
            .from(ingredients)
            .where(inArray(sql`LOWER(${ingredients.name})`, varietyNames));

          for (const child of childRows) {
            if (!visited.has(child.id)) {
              queue.push(child.id);
            }
          }
        }
      }

      const currentNameLower = current.name.trim().toLowerCase();
      const partOfChildren = await db
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(
          sql`EXISTS (SELECT 1 FROM unnest(${ingredients.partOf}) p WHERE LOWER(p) = ${currentNameLower})`,
        );

      for (const child of partOfChildren) {
        if (!visited.has(child.id)) {
          queue.push(child.id);
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
      columns: { id: true, name: true, partOf: true },
    });

    if (!ing) return null;

    const fetchProductsForIngredients = async (targetPgIds: string[]) => {
      if (!targetPgIds || targetPgIds.length === 0) return [];

      const mapped = await db
        .select({
          product: products,
          source: priceSources,
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

      const uniqueMappedMap = new Map<string, { product: ProductRow; source: any }>();
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

      return uniqueMapped.map(({ product, source }) => {
        const latestData = priceMap.get(product.id);
        return {
          ...product,
          source,
          price: latestData ? latestData.latestPrice : product.price,
          currency: latestData ? latestData.currency : product.currency || "LKR",
          lastPriceUpdate: latestData ? latestData.lastUpdated : null,
        };
      });
    };

    const descendantIds = await this.getDescendantIngredientIds(pgId);
    let productsWithLatestPrices = await fetchProductsForIngredients(descendantIds);
    let resolvedFrom: { ingredient: string; relation: string } | undefined = undefined;

    if (productsWithLatestPrices.length > 0 && descendantIds.length > 1) {
      resolvedFrom = {
        ingredient: ing.name,
        relation: "varieties",
      };
    }

    const BROAD_META_CATEGORIES = new Set([
      "fruit",
      "fruits",
      "vegetable",
      "vegetables",
      "meat",
      "spice",
      "spices",
      "herb",
      "herbs",
      "dairy",
      "leafy green",
      "leafy greens",
      "seafood",
      "fish",
      "poultry",
      "grain",
      "grains",
      "root vegetable",
      "root vegetables",
      "tuber",
      "tubers",
    ]);

    if (productsWithLatestPrices.length === 0 && ing.partOf && ing.partOf.length > 0) {
      for (const parentName of ing.partOf) {
        if (!parentName) continue;
        const cleanParent = parentName.trim().toLowerCase();
        if (BROAD_META_CATEGORIES.has(cleanParent)) continue;

        const parentIng = await db.query.ingredients.findFirst({
          where: sql`LOWER(${ingredients.name}) = ${cleanParent}`,
          columns: { id: true, name: true },
        });

        if (parentIng) {
          const parentProducts = await fetchProductsForIngredients([parentIng.id]);
          if (parentProducts.length > 0) {
            productsWithLatestPrices = parentProducts;
            resolvedFrom = {
              ingredient: parentIng.name,
              relation: "part_of",
            };
            break;
          }
        }
      }
    }

    return {
      ingredient: ing.name,
      ingredientId: ing.id,
      products: productsWithLatestPrices,
      ...(resolvedFrom && { resolvedFrom }),
    };
  }
}
