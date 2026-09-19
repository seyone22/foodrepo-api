import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings, products, priceSources } from "../src/utils/schema";
import { eq, ilike, sql } from "drizzle-orm";

async function fixAppleAndCompoundMappings() {
  console.log("🛠️ Fixing Compound Fruit Names, Derived Products & Missing Local Ingredients...\n");

  // 1. Ensure missing canonical ingredients exist in DB
  const missingCanonicalIngredients = [
    { name: "wood apple", aliases: ["woodapple", "divul", "limonia acidissima"] },
    { name: "custard apple", aliases: ["anamoda", "cherimoya", "bullock's heart"] },
    { name: "rose apple", aliases: ["jambu", "wax apple"] },
    { name: "apple juice", aliases: ["apple drink", "apple nectar", "apple cider"] },
    { name: "apple cider vinegar", aliases: ["apple cider vinegr"] },
    { name: "apple sauce", aliases: ["apple puree"] },
    { name: "pineapple juice", aliases: [] },
    { name: "sweet potato", aliases: ["batata", "bathala"] },
  ];

  console.log("📌 Inserting missing compound canonical ingredients into DB...");
  for (const item of missingCanonicalIngredients) {
    const existing = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(eq(ingredients.name, item.name));

    if (existing.length === 0) {
      await db.insert(ingredients).values({
        name: item.name,
        aliases: item.aliases,
        provenance: "SRI_LANKA_SUPERMARKET_FIX",
      });
      console.log(`   + Added missing ingredient: "${item.name}"`);
    }
  }

  // 2. Fetch fresh ingredient map
  const allIngs = await db.select({ id: ingredients.id, name: ingredients.name, aliases: ingredients.aliases }).from(ingredients);

  const ingMap = new Map<string, string>();
  for (const ing of allIngs) {
    ingMap.set(ing.name.toLowerCase().trim(), ing.id);
    for (const a of ing.aliases || []) {
      if (a && a.trim()) ingMap.set(a.toLowerCase().trim(), ing.id);
    }
  }

  const appleId = ingMap.get("apple");
  const woodAppleId = ingMap.get("wood apple");
  const appleJuiceId = ingMap.get("apple juice");
  const appleCiderVinegarId = ingMap.get("apple cider vinegar");
  const appleSauceId = ingMap.get("apple sauce");

  // 3. Re-evaluate all products containing 'apple'
  const appleProducts = await db
    .select({
      id: products.id,
      name: products.name,
      sourceId: products.sourceId,
      sourceName: priceSources.name,
      price: products.price,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
    .where(ilike(products.name, "%apple%"));

  console.log(`\n📦 Found ${appleProducts.length} raw products containing 'apple' in title.`);

  const updateRows: any[] = [];
  let woodAppleCount = 0;
  let appleJuiceCount = 0;
  let vinegarCount = 0;
  let sauceCount = 0;
  let rawAppleCount = 0;
  let otherCount = 0;

  for (const p of appleProducts) {
    const titleLower = p.name.toLowerCase();
    let targetIngId: string | null = null;
    let categoryNote = "";

    if (titleLower.includes("wood apple") || titleLower.includes("woodapple") || titleLower.includes("divul")) {
      targetIngId = woodAppleId || null;
      categoryNote = "Wood Apple (Divul) - Tropical Fruit";
      woodAppleCount++;
    } else if (titleLower.includes("vinegar") || titleLower.includes("vinegr")) {
      targetIngId = appleCiderVinegarId || null;
      categoryNote = "Apple Cider Vinegar Condiment";
      vinegarCount++;
    } else if (titleLower.includes("sauce") || titleLower.includes("puree")) {
      targetIngId = appleSauceId || null;
      categoryNote = "Apple Sauce";
      sauceCount++;
    } else if (
      titleLower.includes("juice") ||
      titleLower.includes("drink") ||
      titleLower.includes("nectar") ||
      titleLower.includes("concentrate") ||
      titleLower.includes("burst") ||
      titleLower.includes("energy")
    ) {
      targetIngId = appleJuiceId || null;
      categoryNote = "Apple Juice / Beverage";
      appleJuiceCount++;
    } else if (
      titleLower.includes("custard apple") ||
      titleLower.includes("rose apple") ||
      titleLower.includes("jambu")
    ) {
      targetIngId = ingMap.get("custard apple") || ingMap.get("rose apple") || null;
      otherCount++;
    } else {
      // Genuine Raw Apples (e.g. Royal Gala, Fuji, Green Apple, Red Apple)
      targetIngId = appleId || null;
      categoryNote = "Raw Fresh Apple Fruit";
      rawAppleCount++;
    }

    if (targetIngId) {
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${targetIngId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: categoryNote,
        meta: JSON.stringify({ isFood: true }),
      });
    }
  }

  // Instant Batch Upsert in raw SQL
  if (updateRows.length > 0) {
    const query = sql`
      INSERT INTO ${mappings} (id, product_id, source_id, matched_ingredients, confidence, method, notes, meta, created_at, updated_at)
      VALUES ${sql.join(
        updateRows.map(
          (m) =>
            sql`(gen_random_uuid(), ${m.productId}::uuid, ${m.sourceId}::uuid, ${m.matchedIngredients}, ${m.confidence}, ${m.method}, ${m.notes}, ${m.meta}::jsonb, NOW(), NOW())`
        ),
        sql`, `
      )}
      ON CONFLICT (product_id, source_id) 
      DO UPDATE SET matched_ingredients = EXCLUDED.matched_ingredients, confidence = EXCLUDED.confidence, method = EXCLUDED.method, notes = EXCLUDED.notes, updated_at = NOW();
    `;
    await db.execute(query);
  }

  console.log("\n==========================================================================================");
  console.log("✅ FIXED MAPPING BREAKDOWN FOR PRODUCTS CONTAINING 'APPLE':");
  console.log("==========================================================================================");
  console.log(`   • Wood Apple (Divul) Products      ➜ Mapped to "wood apple"           : ${woodAppleCount}`);
  console.log(`   • Apple Juices & Beverages        ➜ Mapped to "apple juice"          : ${appleJuiceCount}`);
  console.log(`   • Apple Cider Vinegars             ➜ Mapped to "apple cider vinegar"  : ${vinegarCount}`);
  console.log(`   • Apple Sauces & Purees           ➜ Mapped to "apple sauce"          : ${sauceCount}`);
  console.log(`   • Genuine Fresh Raw Apples        ➜ Mapped to "apple" (Fresh Fruit)  : ${rawAppleCount}`);

  // Query DB to inspect clean raw 'apple' results
  const currentAppleMapped = await db.execute(sql`
    SELECT p.name, ps.name as store, p.price, m.notes
    FROM ${mappings} m
    JOIN ${products} p ON m.product_id = p.id
    JOIN ${priceSources} ps ON p.source_id = ps.id
    WHERE ${appleId}::uuid = ANY(m.matched_ingredients);
  `);

  console.log("\n==========================================================================================");
  console.log(`🍎 REVISED PRODUCTION RESULT SET FOR CANONICAL 'APPLE' (${currentAppleMapped.length} ITEMS):`);
  console.log("==========================================================================================");
  let idx = 1;
  for (const row of currentAppleMapped) {
    console.log(` ${String(idx).padStart(2)}. [${String(row.store).padEnd(8)}] LKR ${Number(row.price).toFixed(2).padStart(7)} | "${row.name}"`);
    idx++;
  }
}

fixAppleAndCompoundMappings()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
