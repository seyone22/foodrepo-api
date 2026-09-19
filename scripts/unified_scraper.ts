import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import {
  products,
  priceHistories,
  stockHistories,
  auditLogs,
} from "@/utils/schema";
import { eq, sql } from "drizzle-orm";
import { normalizeQuantityUnit } from "@/utils/normalizeQtyUtil";

import { CargillsFetcher } from "@/services/cargillsFetcher";
import { KeellsFetcher } from "@/services/keelsFetcher";
import { SparFetcher } from "@/services/sparFetcher";
import { GlomarkFetcher } from "@/services/glomarkFetcher";
import { ArpicoFetcher } from "@/services/arpicoFetcher";


// Define supported stores
const STORES = [
  { name: "Cargills", fetcher: CargillsFetcher, mode: "all" },
  { name: "Keells", fetcher: KeellsFetcher, mode: "all" },
  { name: "SPAR", fetcher: SparFetcher, mode: "all" },
  { name: "Glomark", fetcher: GlomarkFetcher, mode: "all" },
  { name: "Arpico", fetcher: ArpicoFetcher, mode: "all" },
];

const BATCH_SIZE = 500;

async function fetchStoreData(
  storeName: string,
  FetcherClass: any,
  mode: string,
) {
  console.log(`\n🔹 Starting ${storeName} scrape...`);
  const fetcher = new FetcherClass();

  let rawProducts: any[] = [];

  if (mode === "alphabet") {
    const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
    for (const letter of alphabet) {
      console.log(`🔤 Fetching products starting with '${letter}'...`);
      try {
        const result = await fetcher.fetchFromSource({
          itemsPerPage: 10000,
          ingredientName: letter,
        });
        if (Array.isArray(result) && result.length > 0) {
          rawProducts.push(...result);
          console.log(`✅ Got ${result.length} items for '${letter}'`);
        } else {
          console.log(`⚠️ No results for '${letter}'`);
        }
      } catch (err) {
        console.error(`❌ Error fetching '${letter}':`, err);
      }
      await new Promise((r) => setTimeout(r, 500)); // avoid rate limits
    }
  } else {
    console.log("⚙️ Fetching all products...");
    rawProducts = await fetcher.fetchFromSource({
      itemsPerPage: 10000,
      ingredientName: "",
    });
  }

  console.log(
    `📦 Retrieved ${rawProducts.length} raw items from ${storeName}.`,
  );
  return { fetcher, rawProducts };
}

async function processAndUpsert(
  fetcher: any,
  rawProducts: any[],
  storeName: string,
) {
  if (!rawProducts.length) return;

  console.log(`🧪 Normalizing ${storeName} products...`);

  // 1. Map & normalize raw products while deduplicating by (externalId, sourceId)
  const validProductsMap = new Map<string, any>();

  for (const raw of rawProducts) {
    const normalized = fetcher.mapToProduct(raw, "");
    const { quantity, unit } = normalizeQuantityUnit(raw);

    const externalId = normalized.externalId;
    const sourceId = normalized.sourceId || fetcher.sourceId;

    if (!externalId || !sourceId) continue;

    const key = `${externalId}_${sourceId}`;
    validProductsMap.set(key, {
      ...normalized,
      quantity: quantity || normalized.quantity,
      unit: unit || normalized.unit,
      sourceId,
      externalId,
      sku: normalized.itemCode || normalized.sku || null,
      raw: typeof raw === "string" ? raw : JSON.stringify(raw),
    });
  }

  const uniqueMappedProducts = Array.from(validProductsMap.values());
  console.log(
    `💾 Saving/updating ${uniqueMappedProducts.length} unique products for ${storeName} in PostgreSQL (Batch size: ${BATCH_SIZE})...`,
  );

  let upsertCount = 0;
  let dailyPricePoints = 0;
  let dailyStockPoints = 0;

  try {
    // Process in chunks of BATCH_SIZE to avoid hitting statement limits and single-row network overhead
    for (let i = 0; i < uniqueMappedProducts.length; i += BATCH_SIZE) {
      const chunk = uniqueMappedProducts.slice(i, i + BATCH_SIZE);

      const chunkValues = chunk.map((scraped) => ({
        name: scraped.name,
        sourceId: scraped.sourceId,
        brand: scraped.brand || null,
        unit: scraped.unit || null,
        quantity: scraped.quantity ?? 1,
        price: scraped.price,
        mrp: scraped.mrp ?? null,
        currency: scraped.currency || "LKR",
        url: scraped.url || null,
        externalId: scraped.externalId,
        eanBarcode: scraped.eanBarcode || null,
        departmentCode: scraped.departmentCode || null,
        stockInHand: scraped.stockInHand ?? null,
        averageSale: scraped.averageSale ?? null,
        maxQty: scraped.maxQty ?? null,
        categoryPath: scraped.categoryPath || null,
        subDepartmentCode: scraped.subDepartmentCode || null,
        isPromotionApplied: scraped.isPromotionApplied ?? null,
        promotionDiscountValue: scraped.promotionDiscountValue ?? null,
        sku: scraped.sku || null,
        dietaryType: scraped.dietaryType || null,
        packSize: scraped.packSize ?? null,
        searchTerms: scraped.searchTerms || [],
        raw: scraped.raw,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      // Bulk Upsert Core Product Data
      const upsertedRows = await db
        .insert(products)
        .values(chunkValues)
        .onConflictDoUpdate({
          target: [products.externalId, products.sourceId],
          set: {
            name: sql`excluded.name`,
            brand: sql`excluded.brand`,
            unit: sql`excluded.unit`,
            quantity: sql`excluded.quantity`,
            price: sql`excluded.price`,
            mrp: sql`excluded.mrp`,
            currency: sql`excluded.currency`,
            url: sql`excluded.url`,
            externalId: sql`excluded.external_id`,
            eanBarcode: sql`excluded.ean_barcode`,
            departmentCode: sql`excluded.department_code`,
            stockInHand: sql`excluded.stock_in_hand`,
            averageSale: sql`excluded.average_sale`,
            maxQty: sql`excluded.max_qty`,
            categoryPath: sql`excluded.category_path`,
            subDepartmentCode: sql`excluded.sub_department_code`,
            isPromotionApplied: sql`excluded.is_promotion_applied`,
            promotionDiscountValue: sql`excluded.promotion_discount_value`,
            sku: sql`excluded.sku`,
            dietaryType: sql`excluded.dietary_type`,
            packSize: sql`excluded.pack_size`,
            searchTerms: sql`excluded.search_terms`,
            raw: sql`excluded.raw`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: products.id, externalId: products.externalId });

      upsertCount += upsertedRows.length;

      // Build lookup map of externalId -> Database UUID
      const idMap = new Map<string, string>();
      for (const row of upsertedRows) {
        if (row.externalId) {
          idMap.set(row.externalId, row.id);
        }
      }

      const priceBatch: any[] = [];
      const stockBatch: any[] = [];

      for (const scraped of chunk) {
        const dbId = idMap.get(scraped.externalId);
        if (!dbId) continue;

        if (scraped.price !== undefined && scraped.price > 0) {
          priceBatch.push({
            productId: dbId,
            price: scraped.price,
            currency: scraped.currency || "LKR",
          });
        }

        if (scraped.stockInHand !== undefined && scraped.stockInHand !== null) {
          stockBatch.push({
            productId: dbId,
            stock: scraped.stockInHand,
            averageDailySales: scraped.averageSale || null,
          });
        }
      }

      // Bulk Insert Price History
      if (priceBatch.length > 0) {
        await db.insert(priceHistories).values(priceBatch);
        dailyPricePoints += priceBatch.length;
      }

      // Bulk Insert Stock History
      if (stockBatch.length > 0) {
        await db.insert(stockHistories).values(stockBatch);
        dailyStockPoints += stockBatch.length;
      }
    }

    console.log(`✅ ${storeName}: ${upsertCount} products processed.`);
    console.log(
      `📈 Logged ${dailyPricePoints} daily price history data points.`,
    );
    console.log(
      `📊 Logged ${dailyStockPoints} daily stock history data points.`,
    );
  } catch (err: any) {
    console.error(`⚠️ Database error (${storeName}):`, err.message);
    throw err;
  }
}

async function main() {
  console.log("🔸 Starting unified store scrape...");

  // 1. Create an independent Audit Log for THIS specific execution
  let currentLogId: string | null = null;
  try {
    const [currentLog] = await db
      .insert(auditLogs)
      .values({
        type: "SCRAPE_RUN",
        status: "pending",
        tag: "AUTO_SCRAPE",
        initiatedBy: "system_scraper",
        metadata: {
          stores: STORES.map((s) => s.name),
          environment: process.env.NODE_ENV || "development",
        },
      })
      .returning({ id: auditLogs.id });
    currentLogId = currentLog.id;
    console.log(`📝 Audit Log created: ${currentLogId}`);
  } catch (logErr: any) {
    console.error("⚠️ Failed to initialize Audit Log:", logErr.message);
  }

  let successCount = 0;
  let errorMessages: string[] = [];

  // 2. Wrap the loop in a try-catch to ensure the log is updated on failure
  try {
    for (const store of STORES) {
      try {
        const { fetcher, rawProducts } = await fetchStoreData(
          store.name,
          store.fetcher,
          store.mode,
        );
        await processAndUpsert(fetcher, rawProducts, store.name);
        successCount++;
      } catch (err: any) {
        const msg = `❌ Error processing ${store.name}: ${err.message}`;
        console.error(msg);
        errorMessages.push(msg);
      }
    }

    // 3. Finalize success / partial success log
    if (currentLogId) {
      try {
        await db
          .update(auditLogs)
          .set({
            status: errorMessages.length === 0 ? "completed" : "partial_success",
            endTime: new Date(),
            updatedAt: new Date(),
            message: `Finished scraping. Successful stores: ${successCount}/${STORES.length}. ${
              errorMessages.length ? errorMessages.join(" | ") : "All successful."
            }`,
          })
          .where(eq(auditLogs.id, currentLogId));
        console.log("✅ Audit Log finalized.");
      } catch (logErr: any) {
        console.error("⚠️ Failed to finalize Audit Log:", logErr.message);
      }
    }
  } catch (fatalErr: any) {
    // 4. Handle Fatal script-level crashes
    if (currentLogId) {
      try {
        await db
          .update(auditLogs)
          .set({
            status: "failed",
            endTime: new Date(),
            updatedAt: new Date(),
            message: `Fatal Scraper Error: ${fatalErr.message}`,
          })
          .where(eq(auditLogs.id, currentLogId));
      } catch (logErr: any) {
        console.error("⚠️ Failed to update Audit Log on fatal error:", logErr.message);
      }
    }

    throw fatalErr; // Re-throw to trigger GitHub Action failure state
  }
}

// --- Execution Entry Point ---
main()
  .then(() => {
    console.log("🔻 Done. Exiting process.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Fatal execution error:", err);
    process.exit(1);
  });

