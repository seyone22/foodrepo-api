import { Injectable } from "@nestjs/common";
import { db } from "@/database/database.module";
import {
  products,
  priceSources,
  mappings,
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
  or,
  sql,
  isNull,
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
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
};

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

    return {
      products: rows,
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

  async getRandomUnmappedProduct() {
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
      .leftJoin(mappings, eq(mappings.productId, products.id))
      .where(isNull(mappings.id))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    return { product: rows[0] || null };
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
