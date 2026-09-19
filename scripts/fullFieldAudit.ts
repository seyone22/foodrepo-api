import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceSources, ingredients, mappings, usdaFoods } from "@/utils/schema";
import { eq, sql, isNotNull, count } from "drizzle-orm";

async function runFullFieldAudit() {
  console.log("=========================================================================");
  console.log("📊 COMPREHENSIVE FIELD COMPLETENESS AUDIT REPORT");
  console.log("=========================================================================\n");

  // 1. INGREDIENTS TABLE AUDIT
  const totalIngRes = await db.select({ count: sql<number>`count(*)` }).from(ingredients);
  const totalIngredients = Number(totalIngRes[0]?.count || 0);

  console.log(`🥦 1. INGREDIENTS MASTER TABLE`);
  console.log(`Total Master Ingredients: ${totalIngredients}`);
  if (totalIngredients > 0) {
    const ingStats = await db
      .select({
        name: sql<number>`count(${ingredients.name})`,
        aliases: sql<number>`count(case when array_length(${ingredients.aliases}, 1) > 0 then 1 end)`,
        country: sql<number>`count(case when array_length(${ingredients.country}, 1) > 0 then 1 end)`,
        cuisine: sql<number>`count(case when array_length(${ingredients.cuisine}, 1) > 0 then 1 end)`,
        region: sql<number>`count(case when array_length(${ingredients.region}, 1) > 0 then 1 end)`,
        flavorProfile: sql<number>`count(case when array_length(${ingredients.flavorProfile}, 1) > 0 then 1 end)`,
        dietaryFlags: sql<number>`count(case when array_length(${ingredients.dietaryFlags}, 1) > 0 then 1 end)`,
        provenance: sql<number>`count(case when ${ingredients.provenance} IS NOT NULL AND ${ingredients.provenance} != 'MISSING' then 1 end)`,
        comment: sql<number>`count(${ingredients.comment})`,
        pronunciation: sql<number>`count(${ingredients.pronunciation})`,
        fdcId: sql<number>`count(${ingredients.fdcId})`,
        embedding: sql<number>`count(${ingredients.embedding})`,
        image: sql<number>`count(case when (${ingredients.image}->>'missing')::boolean IS FALSE OR ${ingredients.image}->>'url' IS NOT NULL then 1 end)`,
        partOf: sql<number>`count(case when array_length(${ingredients.partOf}, 1) > 0 then 1 end)`,
        derivatives: sql<number>`count(case when array_length(${ingredients.derivatives}, 1) > 0 then 1 end)`,
        varieties: sql<number>`count(case when array_length(${ingredients.varieties}, 1) > 0 then 1 end)`,
        usedIn: sql<number>`count(case when array_length(${ingredients.usedIn}, 1) > 0 then 1 end)`,
        substitutes: sql<number>`count(case when array_length(${ingredients.substitutes}, 1) > 0 then 1 end)`,
        pairsWith: sql<number>`count(case when array_length(${ingredients.pairsWith}, 1) > 0 then 1 end)`,
      })
      .from(ingredients);

    const s = ingStats[0];
    const pct = (val: number) => `${val} (${((val / totalIngredients) * 100).toFixed(1)}%)`;

    console.log(`  ├─ Name:                ${pct(Number(s.name))}`);
    console.log(`  ├─ Aliases:             ${pct(Number(s.aliases))}`);
    console.log(`  ├─ FDC ID (USDA Link):  ${pct(Number(s.fdcId))}`);
    console.log(`  ├─ Vector Embedding:    ${pct(Number(s.embedding))}`);
    console.log(`  ├─ Image URL:           ${pct(Number(s.image))}`);
    console.log(`  ├─ Country / Origin:    ${pct(Number(s.country))}`);
    console.log(`  ├─ Cuisine:             ${pct(Number(s.cuisine))}`);
    console.log(`  ├─ Region:              ${pct(Number(s.region))}`);
    console.log(`  ├─ Flavor Profile:      ${pct(Number(s.flavorProfile))}`);
    console.log(`  ├─ Dietary Flags:       ${pct(Number(s.dietaryFlags))}`);
    console.log(`  ├─ Provenance:          ${pct(Number(s.provenance))}`);
    console.log(`  ├─ Pronunciation:       ${pct(Number(s.pronunciation))}`);
    console.log(`  ├─ Comment / Notes:     ${pct(Number(s.comment))}`);
    console.log(`  ├─ Part Of (Parent):    ${pct(Number(s.partOf))}`);
    console.log(`  ├─ Derivatives:         ${pct(Number(s.derivatives))}`);
    console.log(`  ├─ Varieties:           ${pct(Number(s.varieties))}`);
    console.log(`  ├─ Used In:             ${pct(Number(s.usedIn))}`);
    console.log(`  ├─ Substitutes:         ${pct(Number(s.substitutes))}`);
    console.log(`  └─ Pairs With:          ${pct(Number(s.pairsWith))}\n`);
  }

  // 2. USDA NUTRITION DATABASE AUDIT
  const totalUsdaRes = await db.select({ count: sql<number>`count(*)` }).from(usdaFoods);
  const totalUsda = Number(totalUsdaRes[0]?.count || 0);

  console.log(`🥗 2. USDA FOODS NUTRITION DATABASE`);
  console.log(`Total USDA Foods Cached: ${totalUsda}`);
  if (totalUsda > 0) {
    const usdaStats = await db
      .select({
        description: sql<number>`count(${usdaFoods.description})`,
        foodCategory: sql<number>`count(${usdaFoods.foodCategory})`,
        caloriesKcal: sql<number>`count(${usdaFoods.caloriesKcal})`,
        proteinG: sql<number>`count(${usdaFoods.proteinG})`,
        fatG: sql<number>`count(${usdaFoods.fatG})`,
        carbsG: sql<number>`count(${usdaFoods.carbsG})`,
        fiberG: sql<number>`count(${usdaFoods.fiberG})`,
        sodiumMg: sql<number>`count(${usdaFoods.sodiumMg})`,
        sugarG: sql<number>`count(${usdaFoods.sugarG})`,
      })
      .from(usdaFoods);

    const u = usdaStats[0];
    const pctU = (val: number) => `${val} (${((val / totalUsda) * 100).toFixed(1)}%)`;
    console.log(`  ├─ Description:         ${pctU(Number(u.description))}`);
    console.log(`  ├─ Food Category:       ${pctU(Number(u.foodCategory))}`);
    console.log(`  ├─ Calories (Kcal):     ${pctU(Number(u.caloriesKcal))}`);
    console.log(`  ├─ Protein (g):         ${pctU(Number(u.proteinG))}`);
    console.log(`  ├─ Fat (g):             ${pctU(Number(u.fatG))}`);
    console.log(`  ├─ Carbs (g):           ${pctU(Number(u.carbsG))}`);
    console.log(`  ├─ Fiber (g):           ${pctU(Number(u.fiberG))}`);
    console.log(`  ├─ Sodium (mg):         ${pctU(Number(u.sodiumMg))}`);
    console.log(`  └─ Sugar (g):           ${pctU(Number(u.sugarG))}\n`);
  }

  // 3. SUPERMARKET PRODUCTS & SOURCES AUDIT
  console.log(`🏪 3. SUPERMARKET PRODUCTS BY SOURCE`);
  const sources = await db.select().from(priceSources);
  let overallTotalProducts = 0;

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
        withUnit: sql<number>`count(${products.unit})`,
        withQuantity: sql<number>`count(${products.quantity})`,
        withDietary: sql<number>`count(${products.dietaryType})`,
        withPackSize: sql<number>`count(${products.packSize})`,
        withSearchTerms: sql<number>`count(case when array_length(${products.searchTerms}, 1) > 0 then 1 end)`,
        withStock: sql<number>`count(${products.stockInHand})`,
        withUrl: sql<number>`count(${products.url})`,
        withCategoryPath: sql<number>`count(case when array_length(${products.categoryPath}, 1) > 0 then 1 end)`,
        withExternalId: sql<number>`count(${products.externalId})`,
        withDeptCode: sql<number>`count(${products.departmentCode})`,
        withSubDeptCode: sql<number>`count(${products.subDepartmentCode})`,
        withRaw: sql<number>`count(${products.raw})`,
      })
      .from(products)
      .where(eq(products.sourceId, source.id));

    const s = stats[0];
    const total = Number(s.total) || 0;
    overallTotalProducts += total;

    console.log(`----------------------------------------`);
    console.log(`Store: ${source.name} (${source.country}) [Type: ${source.type}]`);
    console.log(`Total Products: ${total}`);

    if (total === 0) {
      console.log(`⚠️ No products cached.\n`);
      continue;
    }

    const pct = (val: number) => `${val} (${((Number(val) / total) * 100).toFixed(1)}%)`;

    console.log(`  ├─ Name:                ${pct(s.withName)}`);
    console.log(`  ├─ Price:               ${pct(s.withPrice)}`);
    console.log(`  ├─ MSRP (Original):     ${pct(s.withMrp)}`);
    console.log(`  ├─ Unit / Quantity:     ${pct(s.withUnit)} / ${pct(s.withQuantity)}`);
    console.log(`  ├─ Brand:               ${pct(s.withBrand)}`);
    console.log(`  ├─ SKU Code:            ${pct(s.withSku)}`);
    console.log(`  ├─ External ID:         ${pct(s.withExternalId)}`);
    console.log(`  ├─ EAN Barcode:         ${pct(s.withEan)}`);
    console.log(`  ├─ Dietary Type (Veg):  ${pct(s.withDietary)}`);
    console.log(`  ├─ Pack Size:           ${pct(s.withPackSize)}`);
    console.log(`  ├─ Search Terms:        ${pct(s.withSearchTerms)}`);
    console.log(`  ├─ Stock in Hand:       ${pct(s.withStock)}`);
    console.log(`  ├─ Image URL:           ${pct(s.withUrl)}`);
    console.log(`  ├─ Category Path:       ${pct(s.withCategoryPath)}`);
    console.log(`  ├─ Dept / SubDept Code: ${pct(s.withDeptCode)} / ${pct(s.withSubDeptCode)}`);
    console.log(`  └─ Raw Json Payload:    ${pct(s.withRaw)}\n`);
  }

  // 4. MAPPING COVERAGE AUDIT
  console.log(`🔗 4. PRODUCT-TO-INGREDIENT MAPPING COVERAGE`);
  const totalMappingsRes = await db.select({ count: sql<number>`count(*)` }).from(mappings);
  const totalMappings = Number(totalMappingsRes[0]?.count || 0);

  const mappedProductsRes = await db
    .select({ count: sql<number>`count(distinct ${mappings.productId})` })
    .from(mappings)
    .where(sql`array_length(${mappings.matchedIngredients}, 1) > 0`);
  const mappedProductsCount = Number(mappedProductsRes[0]?.count || 0);

  const highConfRes = await db
    .select({ count: sql<number>`count(*)` })
    .from(mappings)
    .where(sql`${mappings.confidence} >= 0.8 AND array_length(${mappings.matchedIngredients}, 1) > 0`);
  const highConfCount = Number(highConfRes[0]?.count || 0);

  const medConfRes = await db
    .select({ count: sql<number>`count(*)` })
    .from(mappings)
    .where(sql`${mappings.confidence} >= 0.5 AND ${mappings.confidence} < 0.8 AND array_length(${mappings.matchedIngredients}, 1) > 0`);
  const medConfCount = Number(medConfRes[0]?.count || 0);

  console.log(`Total Mappings Recorded: ${totalMappings}`);
  console.log(`Mapped Supermarket Products: ${mappedProductsCount} / ${overallTotalProducts} (${((mappedProductsCount / (overallTotalProducts || 1)) * 100).toFixed(1)}%)`);
  console.log(`  ├─ High Confidence (>= 0.8): ${highConfCount} (${((highConfCount / (totalMappings || 1)) * 100).toFixed(1)}%)`);
  console.log(`  ├─ Medium Confidence (0.5 - 0.79): ${medConfCount} (${((medConfCount / (totalMappings || 1)) * 100).toFixed(1)}%)`);
  console.log(`  └─ Low / Unmatched (< 0.5): ${totalMappings - highConfCount - medConfCount} (${(((totalMappings - highConfCount - medConfCount) / (totalMappings || 1)) * 100).toFixed(1)}%)\n`);

  console.log("=========================================================================");
}

runFullFieldAudit()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Audit error:", err);
    process.exit(1);
  });
