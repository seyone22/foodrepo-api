import { db } from "@/database/database.module";
import { priceSources, products, mappings } from "@/database/schema";
import { eq } from "drizzle-orm";
import { toPgId } from "@/common/utils/uuid.util";

export interface FetchProductParams {
  ingredientName?: string;
  productId?: string | number;
  country?: string;
  itemsPerPage?: number;
}

export abstract class SupermarketFetcher {
  abstract sourceName: string;
  abstract country: string;

  protected abstract fetchFromSource(
    params: FetchProductParams,
  ): Promise<any[]>;

  protected abstract mapToProduct(
    raw: any,
    ingredientId?: string,
  ): typeof products.$inferInsert;

  async getProducts(
    ingredientId: string,
    ingredientName: string,
  ): Promise<any[]> {
    const pgIngredientId = toPgId(ingredientId);

    let sourceId: string;
    const existingSource = await db
      .select({ id: priceSources.id })
      .from(priceSources)
      .where(eq(priceSources.name, this.sourceName))
      .limit(1);

    if (existingSource.length > 0) {
      sourceId = existingSource[0].id;
    } else {
      const [newSource] = await db
        .insert(priceSources)
        .values({
          name: this.sourceName,
          country: this.country,
          type: "scraper",
        })
        .returning({ id: priceSources.id });

      sourceId = newSource.id;
    }

    (this as any).sourceId = sourceId;

    const rawProducts = await this.fetchFromSource({ ingredientName });

    if (!rawProducts || rawProducts.length === 0) return [];

    const newProducts: any[] = [];

    for (const raw of rawProducts) {
      try {
        const mapped = this.mapToProduct(raw, pgIngredientId);

        const insertPayload: typeof products.$inferInsert = {
          ...mapped,
          sourceId,
          lastFetched: new Date(),
        };

        const [product] = await db
          .insert(products)
          .values(insertPayload)
          .returning();

        await db.insert(mappings).values({
          productId: product.id,
          sourceId: sourceId,
          matchedIngredients: [pgIngredientId],
          method: "auto",
          confidence: 1.0,
          notes: `Auto-mapped during fetch for: ${ingredientName}`,
        });

        newProducts.push(product);
      } catch (err) {
        console.warn(
          `Failed to create product/mapping for raw item (Name: ${raw.ItemName || raw.title || raw.name || "Unknown"}):`,
          err,
        );
      }
    }

    return newProducts;
  }
}
