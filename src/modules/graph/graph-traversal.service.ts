import { Injectable, Logger } from "@nestjs/common";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/database/database.module";
import {
  ingredients,
  mappings,
  priceHistories,
  priceSources,
  products,
} from "@/database/schema";
import { toPgId } from "@/common/utils/uuid.util";

export type ProductRow = typeof products.$inferSelect;
export type PriceSourceRow = typeof priceSources.$inferSelect;

export type TraversalProduct = ProductRow & {
  source: PriceSourceRow | null;
  lastPriceUpdate?: Date | null;
  matchedIngredients?: string[] | null;
  childIngredient?: {
    id: string;
    name: string;
  };
};

export interface DerivativeMatchMetadata {
  name: string;
  process?: string | null;
  yieldRatio?: number | null;
  lossRatio?: number | null;
  targetId?: string | null;
  notes?: string | null;
}

export interface TraversalResolution {
  ingredientId: string;
  ingredientName: string;
  relation: "direct" | "child" | "parent" | "ancestor" | "derivative" | "substitute";
  level?: number;
  sourceIngredient?: {
    id: string;
    name: string;
  };
  derivative?: DerivativeMatchMetadata;
  density?: number;
  products: TraversalProduct[];
  categories?: Array<{ id: string; name: string; count: number }>;
}

export interface TraversalOptions {
  allowedSources?: string[];
  maxAncestorLevel?: number;
  includeDerivatives?: boolean;
  includeSubstitutes?: boolean;
  disableChildAggregation?: boolean;
}

const PREPARATION_MODIFIERS = new Set([
  "ground",
  "powdered",
  "powder",
  "crushed",
  "grated",
  "whole",
  "fresh",
  "pure",
  "light",
  "dark",
  "raw",
  "fine",
  "dry",
  "dried",
  "unbleached",
  "unsalted",
  "salted",
  "toasted",
  "granulated",
]);

const GENERIC_PARENT_NOUNS = new Set([
  "puree",
  "juice",
  "oil",
  "flour",
  "sauce",
  "powder",
  "extract",
  "essence",
  "paste",
  "syrup",
  "water",
  "drink",
  "leaves",
  "pieces",
  "slices",
  "crush",
  "curry",
  "snack",
  "mix",
  "cream",
  "bean",
  "seed",
  "legume",
  "fruit",
  "vegetable",
  "below",
]);

export const ABSTRACT_TAXONOMY_BLACKLIST = new Set([
  // Physical states & non-ingredient abstractions
  "liquid",
  "solid",
  "gas",
  "fluid",
  "water",
  "below",
  // Broad food groups & kingdoms (never fulfill retail products)
  "spice",
  "spices",
  "herb",
  "herbs",
  "seasoning",
  "seasonings",
  "condiment",
  "condiments",
  "vegetable",
  "vegetables",
  "fruit",
  "fruits",
  "produce",
  "meat",
  "meats",
  "poultry",
  "seafood",
  "fish",
  "dairy",
  "cheese",
  "milk",
  "grain",
  "grains",
  "cereal",
  "cereals",
  "flour",
  "oil",
  "oils",
  "fat",
  "fats",
  "beverage",
  "beverages",
  "drink",
  "drinks",
  "alcohol",
  "liquor",
  "food",
  "ingredient",
  "ingredients",
  "plant",
  "crop",
  "bean",
  "beans",
  "seed",
  "seeds",
  "filling",
  "sauce",
  "mixture",
  "mixtures",
  "mix",
  "mixes",
  "baking",
  "soda",
]);

@Injectable()
export class GraphTraversalService {
  private readonly logger = new Logger(GraphTraversalService.name);
  private readonly resolutionCache = new Map<string, Promise<TraversalResolution | null>>();

  /**
   * Fetch products with latest prices for a list of ingredient UUIDs.
   */
  async fetchProductsForIngredients(
    ingredientIds: string[],
    allowedSources?: string[],
  ): Promise<TraversalProduct[]> {
    if (!ingredientIds.length) return [];

    const validIds = ingredientIds
      .map((id) => {
        try {
          return toPgId(id);
        } catch {
          return null;
        }
      })
      .filter((id): id is string => Boolean(id));

    if (!validIds.length) return [];

    const mappedRows = await db
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
          validIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]`,
      );

    const seenProductIds = new Set<string>();
    const uniqueMapped: typeof mappedRows = [];

    for (const row of mappedRows) {
      if (!seenProductIds.has(row.product.id)) {
        seenProductIds.add(row.product.id);
        if (allowedSources && allowedSources.length > 0) {
          const sName = row.source?.name?.toLowerCase();
          if (!sName || !allowedSources.includes(sName)) {
            continue;
          }
        }
        uniqueMapped.push(row);
      }
    }

    if (uniqueMapped.length === 0) return [];

    const pIds = uniqueMapped.map((m) => m.product.id);
    let latestPrices: Array<{
      productId: string;
      latestPrice: number;
      currency: string | null;
      lastUpdated: Date;
    }> = [];

    try {
      latestPrices = await db
        .selectDistinctOn([priceHistories.productId], {
          productId: priceHistories.productId,
          latestPrice: priceHistories.price,
          currency: priceHistories.currency,
          lastUpdated: priceHistories.timestamp,
        })
        .from(priceHistories)
        .where(inArray(priceHistories.productId, pIds))
        .orderBy(priceHistories.productId, desc(priceHistories.timestamp));
    } catch {
      // Fallback to static product price
    }

    const priceMap = new Map(latestPrices.map((p) => [p.productId, p]));

    return uniqueMapped.map(({ product, source, matchedIngredients }) => {
      const latestData = priceMap.get(product.id);
      return {
        ...product,
        price: latestData ? latestData.latestPrice : product.price,
        currency: latestData ? latestData.currency : product.currency || "LKR",
        source: source || null,
        lastPriceUpdate: latestData ? latestData.lastUpdated : null,
        matchedIngredients: matchedIngredients || [],
      };
    });
  }

  /**
   * Resolves culinary density (g/ml) for an ingredient, traversing up
   * the 'partOf' hierarchy if not set directly, with fallback to 1.0.
   */
  async resolveIngredientDensity(
    ingredientId: string,
    initialPartOf?: string[] | null,
    initialDensity?: number | null,
  ): Promise<number> {
    if (initialDensity != null && initialDensity > 0) {
      return initialDensity;
    }

    let queue: string[] = [];
    if (initialPartOf && Array.isArray(initialPartOf)) {
      queue = initialPartOf.map((p) => p.trim().toLowerCase()).filter(Boolean);
    } else {
      const ing = await db.query.ingredients.findFirst({
        where: eq(ingredients.id, ingredientId),
        columns: { partOf: true, density: true },
      });
      if (ing?.density != null && ing.density > 0) {
        return ing.density;
      }
      if (ing?.partOf && Array.isArray(ing.partOf)) {
        queue = ing.partOf.map((p) => p.trim().toLowerCase()).filter(Boolean);
      }
    }

    const visited = new Set<string>();
    while (queue.length > 0) {
      const nextQueue: string[] = [];
      for (const parentName of queue) {
        if (visited.has(parentName)) continue;
        visited.add(parentName);

        const parent = await db.query.ingredients.findFirst({
          where: sql`LOWER(${ingredients.name}) = ${parentName}`,
          columns: { density: true, partOf: true },
        });

        if (parent) {
          if (parent.density != null && parent.density > 0) {
            return parent.density;
          }
          if (parent.partOf && Array.isArray(parent.partOf)) {
            for (const p of parent.partOf) {
              const pClean = p.trim().toLowerCase();
              if (pClean && !visited.has(pClean)) {
                nextQueue.push(pClean);
              }
            }
          }
        }
      }
      queue = nextQueue;
    }

    return 1.0;
  }

  /**
   * Resolve products and graph relationship starting from a known ingredient UUID.
   */
  async resolveByIngredientId(
    ingredientId: string,
    options: TraversalOptions = {},
  ): Promise<TraversalResolution | null> {
    let pgId: string;
    try {
      pgId = toPgId(ingredientId);
    } catch {
      return null;
    }

    const ing = await db.query.ingredients.findFirst({
      where: eq(ingredients.id, pgId),
      columns: { id: true, name: true, partOf: true, derivatives: true, substitutes: true, density: true },
    });

    if (!ing) return null;

    const resolvedDensity = await this.resolveIngredientDensity(
      ing.id,
      ing.partOf,
      ing.density,
    );

    const nameLower = ing.name.trim().toLowerCase();

    // 1. Direct products
    const directProducts = await this.fetchProductsForIngredients(
      [pgId],
      options.allowedSources,
    );

    // 2. Child ingredients (downward aggregation - skipped if disableChildAggregation is set, unless directProducts is empty)
    if (!options.disableChildAggregation || directProducts.length === 0) {
      const childIngredients = await db
        .select({ id: ingredients.id, name: ingredients.name })
        .from(ingredients)
        .where(sql`${ingredients.partOf} @> ARRAY[${nameLower}]::text[]`);

    if (childIngredients.length > 0) {
      const childIds = childIngredients.map((c) => c.id);
      const childMap = new Map(childIngredients.map((c) => [c.id, c.name]));
      const allIds = [pgId, ...childIds];
      const allProducts = await this.fetchProductsForIngredients(
        allIds,
        options.allowedSources,
      );

      if (allProducts.length > 0) {
        const categoryCounts = new Map<string, number>();
        const directName = `${ing.name} (Direct / Generic)`;

        const categorizedProducts = allProducts.map((p) => {
          const matchedChildId = p.matchedIngredients?.find((id) =>
            childMap.has(id),
          );
          let categoryName = directName;
          let categoryId = pgId;

          if (matchedChildId) {
            categoryName = childMap.get(matchedChildId)!;
            categoryId = matchedChildId;
          }

          categoryCounts.set(
            categoryName,
            (categoryCounts.get(categoryName) || 0) + 1,
          );

          return {
            ...p,
            childIngredient: {
              id: categoryId,
              name: categoryName,
            },
          };
        });

        const hasChildProducts = Array.from(categoryCounts.keys()).some(
          (k) => k !== directName,
        );

        if (hasChildProducts) {
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
            ingredientId: ing.id,
            ingredientName: ing.name,
            relation: "child",
            density: resolvedDensity,
            products: categorizedProducts,
            categories,
          };
        }
      }
    }
  }

    if (directProducts.length > 0) {
      return {
        ingredientId: ing.id,
        ingredientName: ing.name,
        relation: "direct",
        density: resolvedDensity,
        products: directProducts,
      };
    }

    // 3. Derivative check FIRST: Is this ingredient a known derivative of another ingredient?
    if (options.includeDerivatives !== false) {
      const derivativeParent = await this.findParentByDerivativeName(
        ing.name,
        options.allowedSources,
      );
      if (derivativeParent && derivativeParent.products.length > 0) {
        return derivativeParent;
      }
    }

    // 3.5. Substitutes traversal: If direct products, children, and derivatives have no products, check explicit substitutes
    if (
      options.includeSubstitutes !== false &&
      ing.substitutes &&
      Array.isArray(ing.substitutes)
    ) {
      for (const subName of ing.substitutes) {
        const subClean = subName.trim().toLowerCase();
        if (!subClean || ABSTRACT_TAXONOMY_BLACKLIST.has(subClean)) continue;

        const subIng = await db.query.ingredients.findFirst({
          where: sql`LOWER(${ingredients.name}) = ${subClean}`,
          columns: { id: true, name: true, density: true },
        });

        if (subIng) {
          const subResolution = await this.resolveByIngredientId(subIng.id, {
            ...options,
            includeSubstitutes: false,
          });

          if (
            subResolution &&
            subResolution.products.length > 0 &&
            (subResolution.relation === "direct" ||
              subResolution.relation === "child")
          ) {
            return {
              ingredientId: ing.id,
              ingredientName: ing.name,
              relation: "substitute",
              sourceIngredient: {
                id: subIng.id,
                name: subIng.name,
              },
              density: resolvedDensity ?? subResolution.density,
              products: subResolution.products,
              categories: subResolution.categories,
            };
          }
        }
      }
    }

    // 4. Upward ancestor traversal (partOf) with prioritization of specific food nouns
    const maxLevel = options.maxAncestorLevel ?? 4;
    let currentParents = (ing.partOf || [])
      .map((p) => p.trim().toLowerCase())
      .filter((p) => Boolean(p) && !ABSTRACT_TAXONOMY_BLACKLIST.has(p));

    currentParents.sort((a, b) => {
      const aGen = GENERIC_PARENT_NOUNS.has(a) ? 1 : 0;
      const bGen = GENERIC_PARENT_NOUNS.has(b) ? 1 : 0;
      return aGen - bGen;
    });

    let level = 1;
    const visitedParents = new Set<string>([nameLower]);

    while (currentParents.length > 0 && level <= maxLevel) {
      const nextParents: string[] = [];

      for (const parentName of currentParents) {
        if (visitedParents.has(parentName)) continue;
        visitedParents.add(parentName);

        // Never resolve into abstract taxonomy blacklisted categories
        if (ABSTRACT_TAXONOMY_BLACKLIST.has(parentName)) continue;

        const parentIng = await db.query.ingredients.findFirst({
          where: sql`LOWER(${ingredients.name}) = ${parentName}`,
          columns: { id: true, name: true, partOf: true },
        });

        if (parentIng) {
          const parentProducts = await this.fetchProductsForIngredients(
            [parentIng.id],
            options.allowedSources,
          );
          if (parentProducts.length > 0) {
            return {
              ingredientId: ing.id,
              ingredientName: ing.name,
              relation: level === 1 ? "parent" : "ancestor",
              level,
              sourceIngredient: {
                id: parentIng.id,
                name: parentIng.name,
              },
              density: resolvedDensity,
              products: parentProducts,
            };
          }

          if (parentIng.partOf && Array.isArray(parentIng.partOf)) {
            for (const p of parentIng.partOf) {
              const pClean = p.trim().toLowerCase();
              if (
                pClean &&
                !visitedParents.has(pClean) &&
                !ABSTRACT_TAXONOMY_BLACKLIST.has(pClean)
              ) {
                nextParents.push(pClean);
              }
            }
          }
        }
      }

      nextParents.sort((a, b) => {
        const aGen = GENERIC_PARENT_NOUNS.has(a) ? 1 : 0;
        const bGen = GENERIC_PARENT_NOUNS.has(b) ? 1 : 0;
        return aGen - bGen;
      });

      currentParents = nextParents;
      level += 1;
    }

    return null;
  }

  /**
   * Search for parent ingredient whose JSONB derivatives array contains the target name.
   */
  async findParentByDerivativeName(
    derivativeName: string,
    allowedSources?: string[],
  ): Promise<TraversalResolution | null> {
    const clean = derivativeName.trim().toLowerCase();
    if (!clean || clean.length < 3) return null;

    const query = sql`
      SELECT id, name, derivatives, density
      FROM foodrepo.ingredients
      WHERE derivatives IS NOT NULL
        AND jsonb_typeof(derivatives) = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(derivatives) elem
          WHERE (
            lower(elem->>'name') = ${clean}
            OR lower(elem->>'name') = ${clean + 's'}
            OR lower(elem->>'name') || 's' = ${clean}
          )
          AND elem->>'yieldRatio' IS NOT NULL
        )
      ORDER BY
        CASE WHEN lower(name) IN ('puree', 'juice', 'oil', 'powder', 'sauce', 'paste', 'syrup', 'flour', 'mix', 'water', 'below') THEN 1 ELSE 0 END ASC
      LIMIT 5
    `;

    const res = await db.execute(query);
    const rows = (res as any)?.rows || (Array.isArray(res) ? res : []);

    for (const row of rows) {
      const parentProducts = await this.fetchProductsForIngredients(
        [row.id],
        allowedSources,
      );

      if (parentProducts.length > 0) {
        let matchedDerivative: DerivativeMatchMetadata | undefined;
        if (Array.isArray(row.derivatives)) {
          matchedDerivative = row.derivatives.find((d: any) => {
            const dName = String(d?.name || "").toLowerCase().trim();
            return (
              (dName === clean ||
                dName === clean + "s" ||
                dName + "s" === clean) &&
              d.yieldRatio != null
            );
          });
        }

        return {
          ingredientId: row.id,
          ingredientName: row.name,
          relation: "derivative",
          sourceIngredient: {
            id: row.id,
            name: row.name,
          },
          derivative: matchedDerivative,
          density: row.density != null ? Number(row.density) : 1.0,
          products: parentProducts,
        };
      }
    }

    return null;
  }

  /**
   * Resolve an arbitrary text query through multi-tier resolution:
   * Direct -> Aliases -> Derivatives -> Word Substrings.
   */
  async resolveByNameOrQuery(
    queryText: string,
    options: TraversalOptions = {},
  ): Promise<TraversalResolution | null> {
    const clean = queryText.trim().toLowerCase();
    if (!clean) return null;

    const sourcesKey = options.allowedSources ? [...options.allowedSources].sort().join(",") : "";
    const cacheKey = `${clean}::child=${options.disableChildAggregation ? 1 : 0}::deriv=${options.includeDerivatives === false ? 0 : 1}::sub=${options.includeSubstitutes === false ? 0 : 1}::src=${sourcesKey}::max=${options.maxAncestorLevel ?? 4}`;

    if (this.resolutionCache.has(cacheKey)) {
      return this.resolutionCache.get(cacheKey)!;
    }

    const promise = this.executeResolveByNameOrQuery(clean, options);
    this.resolutionCache.set(cacheKey, promise);
    return promise;
  }

  private async executeResolveByNameOrQuery(
    clean: string,
    options: TraversalOptions,
  ): Promise<TraversalResolution | null> {
    // Stage 1: Exact match on canonical ingredient name
    const exactIng = await db.query.ingredients.findFirst({
      where: sql`LOWER(${ingredients.name}) = ${clean}`,
      columns: { id: true, name: true },
    });

    if (exactIng) {
      const resolved = await this.resolveByIngredientId(exactIng.id, options);
      if (resolved && resolved.products.length > 0) {
        return resolved;
      }
    }

    // Stage 2: Match against aliases
    const aliasIng = await db.query.ingredients.findFirst({
      where: sql`${clean} = ANY(SELECT lower(unnest(${ingredients.aliases})))`,
      columns: { id: true, name: true },
    });

    if (aliasIng) {
      const resolved = await this.resolveByIngredientId(aliasIng.id, options);
      if (resolved && resolved.products.length > 0) {
        return resolved;
      }
    }

    // Stage 2.1: Singular / Plural inflection normalization (e.g. "apples" <-> "apple", "tomatoes" <-> "tomato")
    const inflectionCandidates: string[] = [];
    if (clean.endsWith("ies") && clean.length > 4) {
      inflectionCandidates.push(clean.slice(0, -3) + "y");
    }
    if (clean.endsWith("es") && clean.length > 3) {
      inflectionCandidates.push(clean.slice(0, -2));
    }
    if (clean.endsWith("s") && !clean.endsWith("ss") && clean.length > 2) {
      inflectionCandidates.push(clean.slice(0, -1));
    }
    inflectionCandidates.push(clean + "s", clean + "es");

    for (const inf of inflectionCandidates) {
      if (inf === clean) continue;
      const infExact = await db.query.ingredients.findFirst({
        where: sql`LOWER(${ingredients.name}) = ${inf}`,
        columns: { id: true, name: true },
      });
      if (infExact) {
        const resolved = await this.resolveByIngredientId(infExact.id, options);
        if (resolved && resolved.products.length > 0) {
          return resolved;
        }
      }

      const infAlias = await db.query.ingredients.findFirst({
        where: sql`${inf} = ANY(SELECT lower(unnest(${ingredients.aliases})))`,
        columns: { id: true, name: true },
      });
      if (infAlias) {
        const resolved = await this.resolveByIngredientId(infAlias.id, options);
        if (resolved && resolved.products.length > 0) {
          return resolved;
        }
      }
    }

    // Stage 2.5: Preparation modifier stripping (e.g. "ground cinnamon" -> "cinnamon", "light brown sugar" -> "brown sugar")
    const wordsList = clean.split(/\s+/);
    const strippedWords = wordsList.filter((w) => !PREPARATION_MODIFIERS.has(w));
    if (strippedWords.length > 0 && strippedWords.length < wordsList.length) {
      const strippedClean = strippedWords.join(" ");
      const strippedDirect = await db.query.ingredients.findFirst({
        where: sql`LOWER(${ingredients.name}) = ${strippedClean}`,
        columns: { id: true, name: true },
      });
      if (strippedDirect) {
        const resolved = await this.resolveByIngredientId(strippedDirect.id, options);
        if (resolved && resolved.products.length > 0) {
          return {
            ...resolved,
            relation: resolved.relation === "direct" ? "direct" : resolved.relation,
          };
        }
      }

      const strippedAlias = await db.query.ingredients.findFirst({
        where: sql`${strippedClean} = ANY(SELECT lower(unnest(${ingredients.aliases})))`,
        columns: { id: true, name: true },
      });
      if (strippedAlias) {
        const resolved = await this.resolveByIngredientId(strippedAlias.id, options);
        if (resolved && resolved.products.length > 0) {
          return resolved;
        }
      }
    }

    // Stage 3: Structured Derivative Inversion Search
    if (options.includeDerivatives !== false) {
      const derivativeResolved = await this.findParentByDerivativeName(
        clean,
        options.allowedSources,
      );
      if (derivativeResolved && derivativeResolved.products.length > 0) {
        return derivativeResolved;
      }
    }

    // Stage 4: Substring word extraction
    const words = clean
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["and", "the", "with", "fresh", "raw"].includes(w));

    if (words.length > 1) {
      const candidateSubstrings = [words[0], words.slice(1).join(" ")];

      for (const sub of candidateSubstrings) {
        if (sub.length < 3) continue;

        const baseIng = await db.query.ingredients.findFirst({
          where: sql`LOWER(${ingredients.name}) = ${sub}`,
          columns: { id: true, name: true },
        });

        if (baseIng) {
          const resolved = await this.resolveByIngredientId(baseIng.id, options);
          if (resolved && resolved.products.length > 0) {
            return {
              ...resolved,
              relation: resolved.relation === "direct" ? "parent" : resolved.relation,
              sourceIngredient: {
                id: baseIng.id,
                name: baseIng.name,
              },
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Scale derivative portion requirements back to base raw ingredient requirements.
   */
  scaleDerivativeQuantity(
    recipeQuantity: number,
    recipeUnit: string,
    yieldRatio?: number | null,
  ): {
    scaledQuantity: number;
    scaledUnit: string;
    conversionFactor: number;
    note: string;
  } {
    const ratio = yieldRatio && yieldRatio > 0 && yieldRatio <= 1 ? yieldRatio : 1.0;
    const factor = 1.0 / ratio;
    const scaledQuantity = Math.round(recipeQuantity * factor * 100) / 100;

    let note = "";
    if (ratio < 1.0) {
      const yieldPct = Math.round(ratio * 100);
      note = `Derived preparation (${yieldPct}% yield: ${recipeQuantity} ${recipeUnit} requires ~${scaledQuantity} ${recipeUnit} raw base ingredient)`;
    }

    return {
      scaledQuantity,
      scaledUnit: recipeUnit,
      conversionFactor: factor,
      note,
    };
  }
}