import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources, ingredients, mappings } from "../src/utils/schema";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function auditIngredientMappings() {
  console.log("==========================================================================================");
  console.log("🥗 SUPERMARKET PRODUCT ➜ INGREDIENT MAPPING COVERAGE AUDIT");
  console.log("==========================================================================================");

  // 1. Overall counts
  const [{ count: totalIngredients }] = await db.select({ count: sql<number>`count(*)` }).from(ingredients);
  const [{ count: totalProducts }] = await db.select({ count: sql<number>`count(*)` }).from(products);
  const [{ count: totalMappings }] = await db.select({ count: sql<number>`count(*)` }).from(mappings);

  // Mapped products count (products that have a mapping with at least 1 matched ingredient)
  const [{ count: mappedProductsCount }] = await db.select({
    count: sql<number>`count(distinct ${mappings.productId})`
  })
  .from(mappings)
  .where(sql`array_length(${mappings.matchedIngredients}, 1) > 0`);

  const unmappedProductsCount = totalProducts - mappedProductsCount;
  const coveragePct = ((mappedProductsCount / (totalProducts || 1)) * 100).toFixed(1);

  console.log(`\n📊 OVERALL MAPPING SUMMARY:`);
  console.log(`   • Total Canonical Ingredients in DB : ${totalIngredients.toLocaleString()}`);
  console.log(`   • Total Supermarket SKUs in DB      : ${totalProducts.toLocaleString()}`);
  console.log(`   • Total Mappings Created           : ${totalMappings.toLocaleString()}`);
  console.log(`   • Mapped SKUs (Linked to Ingredient): ${mappedProductsCount.toLocaleString()} (${coveragePct}%)`);
  console.log(`   • Unmapped SKUs                    : ${unmappedProductsCount.toLocaleString()} (${(100 - parseFloat(coveragePct)).toFixed(1)}%)`);

  // 2. Breakdown by Supermarket
  const storeBreakdown = await db
    .select({
      storeName: priceSources.name,
      totalProducts: sql<number>`count(distinct ${products.id})`,
      mappedProducts: sql<number>`count(distinct case when array_length(${mappings.matchedIngredients}, 1) > 0 then ${products.id} end)`,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
    .leftJoin(mappings, eq(products.id, mappings.productId))
    .groupBy(priceSources.name);

  console.log("\n==========================================================================================");
  console.log("🏬 INGREDIENT MAPPING COVERAGE BY SUPERMARKET CHAIN");
  console.log("==========================================================================================");
  console.log(`| Supermarket Chain   | Total SKUs in DB | Mapped SKUs (Linked) | Coverage % | Unmapped SKUs |`);
  console.log(`|---------------------|------------------|----------------------|------------|---------------|`);

  for (const s of storeBreakdown) {
    const tot = Number(s.totalProducts);
    const mapCount = Number(s.mappedProducts);
    const unmapCount = tot - mapCount;
    const pct = ((mapCount / (tot || 1)) * 100).toFixed(1) + "%";

    console.log(
      `| ${s.storeName.padEnd(19)} | ${String(tot).padStart(16)} | ${String(mapCount).padStart(20)} | ${pct.padStart(10)} | ${String(unmapCount).padStart(13)} |`
    );
  }

  // 3. Mapping Method & Confidence Breakdown
  const methodStats = await db
    .select({
      method: mappings.method,
      count: sql<number>`count(*)`,
      avgConfidence: sql<number>`avg(${mappings.confidence})`,
      highConfCount: sql<number>`count(case when ${mappings.confidence} >= 0.8 then 1 end)`,
      medConfCount: sql<number>`count(case when ${mappings.confidence} >= 0.5 and ${mappings.confidence} < 0.8 then 1 end)`,
      lowConfCount: sql<number>`count(case when ${mappings.confidence} < 0.5 then 1 end)`,
    })
    .from(mappings)
    .groupBy(mappings.method);

  console.log("\n==========================================================================================");
  console.log("🤖 MAPPING METHOD & CONFIDENCE SCORE DISTRIBUTION");
  console.log("==========================================================================================");
  console.log(`| Mapping Method | Total Mappings | Avg Confidence | High (≥80%) | Med (50-79%) | Low (<50%) |`);
  console.log(`|----------------|----------------|----------------|-------------|--------------|------------|`);

  for (const m of methodStats) {
    const methodStr = (m.method || "manual").padEnd(14);
    const tot = String(m.count).padStart(14);
    const avgConf = m.avgConfidence ? (Number(m.avgConfidence) * 100).toFixed(1) + "%" : "N/A";
    const highStr = String(m.highConfCount).padStart(11);
    const medStr = String(m.medConfCount).padStart(12);
    const lowStr = String(m.lowConfCount).padStart(10);

    console.log(`| ${methodStr} | ${tot} | ${avgConf.padStart(14)} | ${highStr} | ${medStr} | ${lowStr} |`);
  }

  // 4. Top 20 Most Frequently Mapped Ingredients
  const topIngredients = await db.execute(sql`
    SELECT 
      i.name as ingredient_name,
      count(m.id) as linked_product_count
    FROM ${mappings} m,
    UNNEST(m.matched_ingredients) as ing_id
    JOIN ${ingredients} i ON i.id = ing_id
    GROUP BY i.name
    ORDER BY linked_product_count DESC
    LIMIT 20
  `);

  console.log("\n==========================================================================================");
  console.log("🏆 TOP 20 MOST FREQUENTLY LINKED CANONICAL INGREDIENTS");
  console.log("==========================================================================================");
  console.log(`| Rank | Ingredient Name                             | Linked Supermarket SKUs |`);
  console.log(`|------|---------------------------------------------|-------------------------|`);

  let rank = 1;
  for (const row of topIngredients) {
    const ingName = String(row.ingredient_name).padEnd(43).slice(0, 43);
    const cnt = String(row.linked_product_count).padStart(23);
    console.log(`| #${String(rank).padStart(2)} | ${ingName} | ${cnt} |`);
    rank++;
  }

  // 5. Unmapped Product Categories / Types (Inspect sample unmapped products)
  const unmappedSamples = await db.execute(sql`
    SELECT p.name, ps.name as store, p.price
    FROM ${products} p
    INNER JOIN ${priceSources} ps ON p.source_id = ps.id
    LEFT JOIN ${mappings} m ON p.id = m.product_id
    WHERE m.id IS NULL OR array_length(m.matched_ingredients, 1) = 0 OR array_length(m.matched_ingredients, 1) IS NULL
    LIMIT 15
  `);

  console.log("\n==========================================================================================");
  console.log("🔍 SAMPLE UNMAPPED SUPERMARKET PRODUCTS (NOT LINKED TO ANY INGREDIENT YET)");
  console.log("==========================================================================================");
  let idx = 1;
  for (const u of unmappedSamples) {
    console.log(` ${String(idx).padStart(2)}. [${String(u.store).padEnd(8)}] LKR ${Number(u.price).toFixed(2).padStart(8)} | "${u.name}"`);
    idx++;
  }

  // Save report artifact file to disk
  const mappingReportPath = path.join(process.cwd(), "ingredient_mapping_audit.json");
  fs.writeFileSync(
    mappingReportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalIngredients,
        totalProducts,
        totalMappings,
        mappedProductsCount,
        unmappedProductsCount,
        coveragePct: parseFloat(coveragePct),
        storeBreakdown,
        methodStats,
        topIngredients: Array.from(topIngredients),
      },
      null,
      2
    )
  );

  console.log(`\n💾 Saved detailed report to ${mappingReportPath}`);
  console.log("==========================================================================================");
}

auditIngredientMappings()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
