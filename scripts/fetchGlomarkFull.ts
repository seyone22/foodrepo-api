import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceHistories, stockHistories } from "@/utils/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { GlomarkFetcher } from "@/services/glomarkFetcher";
import { normalizeQuantityUnit } from "@/utils/normalizeQtyUtil";

const BATCH_SIZE = 500;

async function runGlomarkFullScrape() {
  console.log("🚀 Starting Full GLOMARK Category Traversal & Database Ingestion...");

  const fetcher = new GlomarkFetcher();
  const rawProducts = await fetcher.fetchFromSource({});

  console.log(`📦 Retrieved ${rawProducts.length} raw GLOMARK products across all categories.`);

  if (!rawProducts.length) {
    console.log("⚠️ No products retrieved. Exiting.");
    return;
  }

  const validProductsMap = new Map<string, any>();

  for (const raw of rawProducts) {
    const normalized = fetcher.mapToProduct(raw);
    const { quantity, unit } = normalizeQuantityUnit(raw.title);

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
      sku: normalized.sku || null,
      raw: typeof raw === "string" ? raw : JSON.stringify(raw),
    });
  }

  const uniqueProducts = Array.from(validProductsMap.values());
  console.log(`💾 Upserting ${uniqueProducts.length} unique GLOMARK products into PostgreSQL in batches of ${BATCH_SIZE}...`);

  let upsertedCount = 0;

  for (let i = 0; i < uniqueProducts.length; i += BATCH_SIZE) {
    const batch = uniqueProducts.slice(i, i + BATCH_SIZE);

    const result = await db
      .insert(products)
      .values(batch)
      .onConflictDoUpdate({
        target: [products.externalId, products.sourceId],
        set: {
          name: sql`EXCLUDED.name`,
          price: sql`EXCLUDED.price`,
          mrp: sql`EXCLUDED.mrp`,
          unit: sql`EXCLUDED.unit`,
          quantity: sql`EXCLUDED.quantity`,
          url: sql`EXCLUDED.url`,
          categoryPath: sql`EXCLUDED.category_path`,
          lastFetched: sql`EXCLUDED.last_fetched`,
          raw: sql`EXCLUDED.raw`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({ id: products.id });

    upsertedCount += result.length;
    console.log(`  └─ Batch ${Math.floor(i / BATCH_SIZE) + 1}: Upserted ${result.length} items (Total: ${upsertedCount}/${uniqueProducts.length})`);
  }

  console.log(`\n🎉 GLOMARK full scrape complete! Successfully saved ${upsertedCount} SKUs to database.`);
}

runGlomarkFullScrape()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ GLOMARK scrape failed:", err);
    process.exit(1);
  });
