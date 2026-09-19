import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings, products, priceSources } from "../src/utils/schema";
import { eq, ilike, sql } from "drizzle-orm";

async function fixAllAppleAndPineappleMappings() {
  console.log("🛠️ Executing Ultimate Precision Fix for Apple, Wood Apple, Rose Apple, Jelly & Non-Food Items...\n");

  // 1. Ensure missing canonical ingredients exist in DB
  const missingCanonicalIngredients = [
    { name: "wood apple", aliases: ["woodapple", "divul", "limonia acidissima"] },
    { name: "custard apple", aliases: ["anamoda", "cherimoya"] },
    { name: "rose apple", aliases: ["jambu", "wax apple"] },
    { name: "apple juice", aliases: ["apple drink", "apple nectar", "apple cider"] },
    { name: "apple cider vinegar", aliases: ["apple cider vinegr"] },
    { name: "apple sauce", aliases: ["apple puree"] },
    { name: "apple jelly", aliases: ["apple flavoured jelly", "jelly crystal apple"] },
    { name: "apple tea", aliases: ["iced tea apple", "apple tea"] },
    { name: "pineapple", aliases: ["ananas"] },
    { name: "pineapple juice", aliases: ["pineapple drink"] },
    { name: "pineapple jam", aliases: ["pineapple chutney"] },
  ];

  for (const item of missingCanonicalIngredients) {
    const existing = await db
      .select({ id: ingredients.id })
      .from(ingredients)
      .where(eq(ingredients.name, item.name));

    if (existing.length === 0) {
      await db.insert(ingredients).values({
        name: item.name,
        aliases: item.aliases,
        provenance: "ULTIMATE_SUPERMARKET_FIX",
      });
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
  const roseAppleId = ingMap.get("rose apple");
  const appleJuiceId = ingMap.get("apple juice");
  const appleCiderVinegarId = ingMap.get("apple cider vinegar");
  const appleSauceId = ingMap.get("apple sauce");
  const appleJellyId = ingMap.get("apple jelly");
  const appleTeaId = ingMap.get("apple tea");
  const pineappleId = ingMap.get("pineapple");
  const pineappleJuiceId = ingMap.get("pineapple juice");
  const pineappleJamId = ingMap.get("pineapple jam");

  // Comprehensive Non-Food Regex
  const EXPANDED_NON_FOOD = /\b(dishwash|hand wash|handwash|incense|air freshner|air freshener|power bag|power bags|stop-o|stopo|sachet|fragrance|cologne|hair wax|retinol|serum|coolant|leather|tire shine|detergent|shampoo|conditioner|soap|face wash|lotion|spray|perfume|deodorant|diaper|sanitary|napkin|tissue|paper towel|disinfectant|floor cleaner|cleaner|bleach|radiator|bulb|battery|balloon|stationery|pencil|pen|notebook|dog food|cat food|pet food|broom|mop|insecticide|mosquito|bug spray|toothbrush|toothpaste|mouthwash|skincare|moisturizer|sunscreen|hair color|razor|shaving|cotton buds|bandage|plaster|polish|wipes|candle|matches|foil|wrap|cling|scrubber|sponge|bag|garbage|trash|umbrella|colouring|essence)\b/i;

  // Fetch all products containing 'apple' or 'pineapple' or 'divul' or 'jumbu'
  const appleAndPineappleProducts = await db
    .select({
      id: products.id,
      name: products.name,
      sourceId: products.sourceId,
      sourceName: priceSources.name,
      price: products.price,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
    .where(sql`${products.name} ILIKE '%apple%' OR ${products.name} ILIKE '%divul%' OR ${products.name} ILIKE '%jumbu%'`);

  console.log(`📦 Found ${appleAndPineappleProducts.length} raw products to evaluate with ultimate precision.`);

  const updateRows: any[] = [];
  let counts = {
    nonFood: 0,
    woodApple: 0,
    roseApple: 0,
    appleJelly: 0,
    appleTea: 0,
    appleVinegar: 0,
    appleSauce: 0,
    appleJuice: 0,
    pineapple: 0,
    pineappleJuice: 0,
    pineappleJam: 0,
    freshApple: 0,
  };

  for (const p of appleAndPineappleProducts) {
    const title = p.name.toLowerCase().trim();

    // 1. Non-food check
    if (EXPANDED_NON_FOOD.test(title)) {
      counts.nonFood++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[]::uuid[]`,
        confidence: 1.0,
        method: "non_food_rule",
        notes: "Non-food household SKU classification",
        meta: JSON.stringify({ isFood: false }),
      });
      continue;
    }

    // 2. Wood Apple / Divul
    if (/\b(wood apple|woodapple|divul)\b/i.test(title)) {
      counts.woodApple++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${woodAppleId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: "Wood Apple (Divul)",
        meta: JSON.stringify({ isFood: true }),
      });
      continue;
    }

    // 3. Rose Apple / Jumbu
    if (/\b(rose apple|jumbu|jambu)\b/i.test(title)) {
      counts.roseApple++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${roseAppleId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: "Rose Apple (Jumbu)",
        meta: JSON.stringify({ isFood: true }),
      });
      continue;
    }

    // 4. Pineapple Products
    if (/\b(pineapple|pneapple|pn\/apple|pine apple)\b/i.test(title)) {
      let targetIng = pineappleId;
      let note = "Fresh Pineapple Fruit";

      if (/\b(juice|drink|cordial|smoothie)\b/i.test(title)) {
        targetIng = pineappleJuiceId || pineappleId;
        note = "Pineapple Juice Beverage";
        counts.pineappleJuice++;
      } else if (/\b(jam|chutney)\b/i.test(title)) {
        targetIng = pineappleJamId || pineappleId;
        note = "Pineapple Jam / Chutney";
        counts.pineappleJam++;
      } else {
        counts.pineapple++;
      }

      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${targetIng}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: note,
        meta: JSON.stringify({ isFood: true }),
      });
      continue;
    }

    // 5. Apple Jelly / Jelly Crystals
    if (/\b(jelly|moss jelly)\b/i.test(title) && /\bapple\b/i.test(title)) {
      counts.appleJelly++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${appleJellyId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: "Apple Flavoured Jelly",
        meta: JSON.stringify({ isFood: true }),
      });
      continue;
    }

    // 6. Apple Tea / Iced Green Tea Apple
    if (/\b(tea|iced tea)\b/i.test(title) && /\bapple\b/i.test(title)) {
      counts.appleTea++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${appleTeaId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: "Apple Flavoured Tea",
        meta: JSON.stringify({ isFood: true }),
      });
      continue;
    }

    // 7. Apple Cider Vinegar
    if (/\b(vinegar|vinegr)\b/i.test(title) && /\bapple\b/i.test(title)) {
      counts.appleVinegar++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${appleCiderVinegarId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: "Apple Cider Vinegar",
        meta: JSON.stringify({ isFood: true }),
      });
      continue;
    }

    // 8. Apple Sauce
    if (/\b(sauce|puree)\b/i.test(title) && /\bapple\b/i.test(title)) {
      counts.appleSauce++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${appleSauceId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: "Apple Sauce",
        meta: JSON.stringify({ isFood: true }),
      });
      continue;
    }

    // 9. Apple Juices & Drinks
    if (/\b(juice|drink|nectar|concentrate|burst|energy|beer|twistee|squash|smoothie|wam|ufresh)\b/i.test(title) && /\bapple\b/i.test(title)) {
      counts.appleJuice++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${appleJuiceId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: "Apple Juice / Beverage",
        meta: JSON.stringify({ isFood: true }),
      });
      continue;
    }

    // 10. True Fresh Raw Apples (Word Boundary: \bapple\b)
    if (/\bapple\b/i.test(title)) {
      counts.freshApple++;
      updateRows.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${appleId}::uuid]`,
        confidence: 0.98,
        method: "compound_precision_rule",
        notes: "Raw Fresh Apple Fruit",
        meta: JSON.stringify({ isFood: true }),
      });
    }
  }

  // Execute batch upsert
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
  console.log("✅ ULTIMATE PRECISION MAPPING BREAKDOWN FOR APPLE & PINEAPPLE PRODUCTS:");
  console.log("==========================================================================================");
  console.log(`   • Non-Food Items (Handwash, Air Freshener, Incense) ➜ Marked Non-Food : ${counts.nonFood}`);
  console.log(`   • Wood Apple (Divul)                          ➜ Mapped to "wood apple"    : ${counts.woodApple}`);
  console.log(`   • Rose Apple (Jumbu)                          ➜ Mapped to "rose apple"    : ${counts.roseApple}`);
  console.log(`   • Pineapples (Fresh Fruit)                    ➜ Mapped to "pineapple"     : ${counts.pineapple}`);
  console.log(`   • Pineapple Juices & Drinks                   ➜ Mapped to "pineapple juice": ${counts.pineappleJuice}`);
  console.log(`   • Pineapple Jams & Chutneys                   ➜ Mapped to "pineapple jam"  : ${counts.pineappleJam}`);
  console.log(`   • Apple Juices & Beverages                    ➜ Mapped to "apple juice"   : ${counts.appleJuice}`);
  console.log(`   • Apple Jellies & Desserts                    ➜ Mapped to "apple jelly"   : ${counts.appleJelly}`);
  console.log(`   • Apple Teas                                  ➜ Mapped to "apple tea"     : ${counts.appleTea}`);
  console.log(`   • Apple Cider Vinegars                        ➜ Mapped to "apple cider vinegar": ${counts.appleVinegar}`);
  console.log(`   • Apple Sauces                                ➜ Mapped to "apple sauce"   : ${counts.appleSauce}`);
  console.log(`   • Genuine Fresh Raw Apples                    ➜ Mapped to "apple" (Fruit) : ${counts.freshApple}`);

  // Query Database to inspect verified clean result set for canonical 'apple'
  const cleanAppleMapped = await db.execute(sql`
    SELECT p.name, ps.name as store, p.price, m.notes
    FROM ${mappings} m
    JOIN ${products} p ON m.product_id = p.id
    JOIN ${priceSources} ps ON p.source_id = ps.id
    WHERE ${appleId}::uuid = ANY(m.matched_ingredients);
  `);

  console.log("\n==========================================================================================");
  console.log(`🍎 VERIFIED CLEAN RESULT SET FOR CANONICAL 'APPLE' (${cleanAppleMapped.length} ITEMS):`);
  console.log("==========================================================================================");
  let idx = 1;
  for (const row of cleanAppleMapped) {
    console.log(` ${String(idx).padStart(2)}. [${String(row.store).padEnd(8)}] LKR ${Number(row.price).toFixed(2).padStart(7)} | "${row.name}"`);
    idx++;
  }
}

fixAllAppleAndPineappleMappings()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
