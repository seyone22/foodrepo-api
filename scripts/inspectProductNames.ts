import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources } from "../src/utils/schema";
import { sql, eq, ilike } from "drizzle-orm";

async function inspectProductData() {
  console.log("🔍 Inspecting product database schema fields & sample titles...\n");

  // 1. Check field population counts
  const fieldStats = await db.select({
    total: sql<number>`count(*)`,
    hasBarcode: sql<number>`count(case when ean_barcode is not null and ean_barcode != '' then 1 end)`,
    hasSku: sql<number>`count(case when sku is not null and sku != '' then 1 end)`,
    hasBrand: sql<number>`count(case when brand is not null and brand != '' then 1 end)`,
    hasUnit: sql<number>`count(case when unit is not null and unit != '' then 1 end)`,
    hasPackSize: sql<number>`count(case when pack_size is not null then 1 end)`,
  }).from(products);

  console.log("📊 Metadata Population Stats across all 17,907 SKUs:");
  console.table(fieldStats[0]);

  // 2. Fetch samples for well-known Sri Lankan brands / staples across stores
  const stapleKeywords = ["anchor", "munchee", "maliban", "cBL", "harvest", "dicon", "kottu", "saman", "nestle", "milo", "sunlight", "fortune", "prima", "watawala", "ceylon tea"];

  console.log("\n==========================================================================================");
  console.log("🏷️ SAMPLE PRODUCT TITLES ACROSS STORES FOR POPULAR STAPLES / BRANDS");
  console.log("==========================================================================================");

  for (const kw of stapleKeywords.slice(0, 5)) {
    const samples = await db
      .select({
        store: priceSources.name,
        name: products.name,
        brand: products.brand,
        price: products.price,
        unit: products.unit,
        ean: products.eanBarcode,
      })
      .from(products)
      .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
      .where(ilike(products.name, `%${kw}%`))
      .limit(10);

    console.log(`\n📌 Search Keyword: "${kw.toUpperCase()}" (${samples.length} sample results shown):`);
    for (const s of samples) {
      console.log(`   [${s.store.padEnd(8)}] LKR ${String(s.price).padStart(7)} | Name: "${s.name}" | Brand: ${s.brand || 'N/A'} | Unit: ${s.unit || 'N/A'}`);
    }
  }

  // 3. Check for specific top products across stores to evaluate title naming patterns
  console.log("\n==========================================================================================");
  console.log("🧪 DIRECT COMPLETED CASE STUDY: 'ANCHOR' MILK POWDER ACROSS ALL STORES");
  console.log("==========================================================================================");
  const milkSamples = await db
    .select({
      store: priceSources.name,
      name: products.name,
      price: products.price,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
    .where(ilike(products.name, "%anchor%milk%"));

  for (const m of milkSamples) {
    console.log(`   [${m.store.padEnd(8)}] LKR ${m.price.toFixed(2).padStart(8)} | "${m.name}"`);
  }
}

inspectProductData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
