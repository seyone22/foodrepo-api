import { Injectable } from "@nestjs/common";
import { db } from "@/database/database.module";
import {
  products,
  priceSources,
  mappings,
  ingredients,
  stockHistories,
  priceHistories,
} from "@/database/schema";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  notExists,
  or,
  sql,
  isNull,
  type SQL,
} from "drizzle-orm";
import { toPgId } from "@/common/utils/uuid.util";

const productColumns = {
  id: products.id,
  name: products.name,
  sourceId: products.sourceId,
  brand: products.brand,
  unit: products.unit,
  quantity: products.quantity,
  price: products.price,
  currency: products.currency,
  lastFetched: products.lastFetched,
  url: products.url,
  externalId: products.externalId,
  departmentCode: products.departmentCode,
  stockInHand: products.stockInHand,
  averageSale: products.averageSale,
  maxQty: products.maxQty,
  categoryPath: products.categoryPath,
  subDepartmentCode: products.subDepartmentCode,
  isPromotionApplied: products.isPromotionApplied,
  promotionDiscountValue: products.promotionDiscountValue,
  sku: products.sku,
  raw: products.raw,
  eanBarcode: products.eanBarcode,
  mrp: products.mrp,
  dietaryType: products.dietaryType,
  packSize: products.packSize,
  searchTerms: products.searchTerms,
  claimedUntil: products.claimedUntil,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
};

const DEFAULT_NON_FOOD_CATEGORIES = [
  "household",
  "health & beauty",
  "personal care",
  "pet care",
  "stationery",
  "home & living",
  "homeware",
  "pharmacy",
  "baby care",
  "baby products",
  "cleaning",
  "electronics",
  "hardware",
  "cosmetics",
];

@Injectable()
export class ProductsService {
  async searchProducts(query: string = "", page: number = 1, limit: number = 25) {
    const offset = (page - 1) * limit;
    const cleanQuery = query.trim();

    const whereClause = cleanQuery
      ? or(
          ilike(products.name, `%${cleanQuery}%`),
          ilike(products.sku, `%${cleanQuery}%`),
          ilike(products.eanBarcode, `%${cleanQuery}%`),
        )
      : undefined;

    const [rows, totalResult] = await Promise.all([
      db
        .select({
          ...productColumns,
          source: {
            id: priceSources.id,
            name: priceSources.name,
          },
        })
        .from(products)
        .leftJoin(priceSources, eq(products.sourceId, priceSources.id))
        .where(whereClause)
        .orderBy(asc(products.name))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: sql<number>`count(*)` })
        .from(products)
        .where(whereClause),
    ]);

    const total = Number(totalResult[0]?.value ?? 0);

    let productsWithMapping: any[] = rows.map((r) => ({ ...r, currentMapping: null }));
    if (rows.length > 0) {
      const productIds = rows.map((r) => r.id);
      try {
        const existingMappings = await db
          .select({
            productId: mappings.productId,
            ingredientId: ingredients.id,
            ingredientName: ingredients.name,
          })
          .from(mappings)
          .leftJoin(
            ingredients,
            sql`${ingredients.id} = ${mappings.matchedIngredients}[1]`,
          )
          .where(inArray(mappings.productId, productIds));

        const mappingMap = new Map<
          string,
          { ingredientId: string; ingredientName: string }
        >();
        for (const m of existingMappings) {
          if (m.productId && m.ingredientId && m.ingredientName) {
            mappingMap.set(m.productId, {
              ingredientId: m.ingredientId,
              ingredientName: m.ingredientName,
            });
          }
        }

        productsWithMapping = rows.map((r) => ({
          ...r,
          currentMapping: mappingMap.get(r.id) ?? null,
        }));
      } catch (e) {
        // Fallback gracefully without mapping if query fails
      }
    }

    return {
      products: productsWithMapping,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  async fetchProductsByIds(ids: string[]) {
    if (!ids || ids.length === 0) {
      return { products: [], total: 0 };
    }

    const pgIds = ids.map((id) => toPgId(id));

    const rows = await db
      .select({
        ...productColumns,
        source: {
          id: priceSources.id,
          name: priceSources.name,
        },
      })
      .from(products)
      .leftJoin(priceSources, eq(products.sourceId, priceSources.id))
      .where(inArray(products.id, pgIds));

    return { products: rows, total: rows.length };
  }

  async getRandomUnmappedProducts(options: {
    limit?: number;
    claimMinutes?: number;
    excludeNonFood?: boolean;
    excludeCategories?: string;
  } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 1, 1), 100);
    const conditions: SQL[] = [
      notExists(
        db
          .select({ id: mappings.id })
          .from(mappings)
          .where(eq(mappings.productId, products.id)),
      ),
      sql`(${products.claimedUntil} IS NULL OR ${products.claimedUntil} < NOW())`,
    ];

    const excludedTerms: string[] = [];
    if (options.excludeNonFood) {
      excludedTerms.push(...DEFAULT_NON_FOOD_CATEGORIES);
    }
    if (options.excludeCategories) {
      for (const term of options.excludeCategories.split(",")) {
        const trimmed = term.trim().toLowerCase();
        if (trimmed) excludedTerms.push(trimmed);
      }
    }

    for (const term of new Set(excludedTerms)) {
      conditions.push(
        sql`(${products.categoryPath} IS NULL OR lower(array_to_string(${products.categoryPath}, ' ')) NOT LIKE ${`%${term}%`})`,
      );
    }

    const whereClause = and(...conditions);

    let rows: any[];
    if (options.claimMinutes && options.claimMinutes > 0) {
      const claimExpiry = new Date(
        Date.now() + options.claimMinutes * 60 * 1000,
      );

      rows = await db.transaction(async (tx) => {
        const candidates = await tx
          .select({ id: products.id })
          .from(products)
          .where(whereClause)
          .orderBy(sql`RANDOM()`)
          .for("update", { skipLocked: true })
          .limit(limit);

        if (candidates.length === 0) {
          return [];
        }

        const ids = candidates.map((c) => c.id);
        await tx
          .update(products)
          .set({ claimedUntil: claimExpiry })
          .where(inArray(products.id, ids));

        return tx
          .select({
            ...productColumns,
            source: {
              id: priceSources.id,
              name: priceSources.name,
            },
          })
          .from(products)
          .leftJoin(priceSources, eq(products.sourceId, priceSources.id))
          .where(inArray(products.id, ids));
      });
    } else {
      rows = await db
        .select({
          ...productColumns,
          source: {
            id: priceSources.id,
            name: priceSources.name,
          },
        })
        .from(products)
        .leftJoin(priceSources, eq(products.sourceId, priceSources.id))
        .where(whereClause)
        .orderBy(sql`RANDOM()`)
        .limit(limit);
    }

    return {
      product: rows[0] || null,
      products: rows,
      count: rows.length,
    };
  }

  async getProductStockHistory(productId: string): Promise<number[]> {
    const pgProductId = toPgId(productId);

    const historyData = await db
      .select({
        averageDailySales: stockHistories.averageDailySales,
      })
      .from(stockHistories)
      .where(eq(stockHistories.productId, pgProductId))
      .orderBy(desc(stockHistories.timestamp))
      .limit(30);

    if (!historyData || historyData.length === 0) {
      return [];
    }

    const chronological = historyData.reverse();
    return chronological.map((record) => record.averageDailySales ?? 0);
  }

  async getProductPriceHistory(productId: string) {
    const pgProductId = toPgId(productId);
    const history = await db
      .select({
        price: priceHistories.price,
        timestamp: priceHistories.timestamp,
      })
      .from(priceHistories)
      .where(eq(priceHistories.productId, pgProductId))
      .orderBy(asc(priceHistories.timestamp));

    return history.map((h) => ({
      date: new Date(h.timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      price: h.price,
      fullDate: h.timestamp,
    }));
  }

}
