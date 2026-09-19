import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceSources } from "@/utils/schema";
import { eq, sql } from "drizzle-orm";

async function runDataCompletenessAudit() {
  console.log("📊 Starting Supermarket Data Completeness Audit...\n");

  const sources = await db.select().from(priceSources);

  for (const source of sources) {
    const stats = await db
      .select({
        total: sql<number>`count(*)`,
        withName: sql<number>`count(${products.name})`,
        withPrice: sql<number>`count(${products.price})`,
        withMrp: sql<number>`count(${products.mrp})`,
        withEan: sql<number>`count(${products.eanBarcode})`,
        withSku: sql<number>`count(${products.sku})`,
        withBrand: sql<number>`count(${products.brand})`,
        withDietary: sql<number>`count(${products.dietaryType})`,
        withPackSize: sql<number>`count(${products.packSize})`,
        withSearchTerms: sql<number>`count(case when array_length(${products.searchTerms}, 1) > 0 then 1 end)`,
        withStock: sql<number>`count(${products.stockInHand})`,
        withUrl: sql<number>`count(${products.url})`,
        withCategoryPath: sql<number>`count(case when array_length(${products.categoryPath}, 1) > 0 then 1 end)`,
      })
      .from(products)
      .where(eq(products.sourceId, source.id));

    const s = stats[0];
    const total = Number(s.total) || 0;

    console.log(`========================================`);
    console.log(`🏬 STORE: ${source.name} (${source.country})`);
    console.log(`========================================`);
    console.log(`📦 Total Products: ${total}`);

    if (total === 0) {
      console.log(`⚠️ No products found for ${source.name}.\n`);
      continue;
    }

    const pct = (val: number) => `${((Number(val) / total) * 100).toFixed(1)}%`;

    console.log(`  ├─ Name:                ${s.withName} (${pct(s.withName)})`);
    console.log(`  ├─ Price:               ${s.withPrice} (${pct(s.withPrice)})`);
    console.log(`  ├─ MSRP (Original):     ${s.withMrp} (${pct(s.withMrp)})`);
    console.log(`  ├─ EAN Barcode:         ${s.withEan} (${pct(s.withEan)})`);
    console.log(`  ├─ SKU Code:            ${s.withSku} (${pct(s.withSku)})`);
    console.log(`  ├─ Brand:               ${s.withBrand} (${pct(s.withBrand)})`);
    console.log(`  ├─ Dietary Type (Veg):  ${s.withDietary} (${pct(s.withDietary)})`);
    console.log(`  ├─ Pack Size:           ${s.withPackSize} (${pct(s.withPackSize)})`);
    console.log(`  ├─ Search Terms:        ${s.withSearchTerms} (${pct(s.withSearchTerms)})`);
    console.log(`  ├─ Stock in Hand:       ${s.withStock} (${pct(s.withStock)})`);
    console.log(`  ├─ Product Image URL:   ${s.withUrl} (${pct(s.withUrl)})`);
    console.log(`  └─ Category Path:       ${s.withCategoryPath} (${pct(s.withCategoryPath)})\n`);
  }
}

runDataCompletenessAudit()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Audit error:", err);
    process.exit(1);
  });
