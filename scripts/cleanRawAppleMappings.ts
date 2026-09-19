import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings, products, priceSources } from "../src/utils/schema";
import { eq, sql } from "drizzle-orm";

async function cleanRawAppleMappings() {
  console.log("🛠️ Instant Batch Cleanup of Raw 'Apple' Ingredient Mappings in PostgreSQL...\n");

  // Fetch canonical ingredient IDs
  const allIngs = await db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients);
  const ingMap = new Map<string, string>();
  for (const ing of allIngs) ingMap.set(ing.name.toLowerCase().trim(), ing.id);

  // Ensure target ingredients exist in DB
  const missingTargets = ["apple juice", "muesli", "apple sauce", "apple jelly", "energy drink", "soft drink", "fruit squash"];
  for (const name of missingTargets) {
    if (!ingMap.has(name)) {
      const inserted = await db.insert(ingredients).values({ name, aliases: [], provenance: "CLEANUP_FIX" }).returning({ id: ingredients.id });
      ingMap.set(name, inserted[0].id);
    }
  }

  const appleId = ingMap.get("apple")!;
  const appleJuiceId = ingMap.get("apple juice")!;
  const muesliId = ingMap.get("muesli")!;
  const appleSauceId = ingMap.get("apple sauce")!;
  const appleJellyId = ingMap.get("apple jelly")!;
  const energyDrinkId = ingMap.get("energy drink")!;
  const softDrinkId = ingMap.get("soft drink")!;
  const fruitSquashId = ingMap.get("fruit squash")!;

  // Fetch all products currently mapped to appleId
  const rows = await db.execute(sql`
    SELECT p.id as product_id, p.source_id, p.name, ps.name as store
    FROM ${mappings} m
    JOIN ${products} p ON m.product_id = p.id
    JOIN ${priceSources} ps ON p.source_id = ps.id
    WHERE ${appleId}::uuid = ANY(m.matched_ingredients);
  `);

  console.log(`Inspecting ${rows.length} items mapped to raw 'apple'...`);

  const updates: any[] = [];
  let rawAppleCount = 0;
  let remappedCount = 0;

  for (const row of rows) {
    const title = String(row.name).toLowerCase().trim();
    let newIngId: string | null = null;
    let categoryNote = "";

    const isRawFreshApple =
      (title.includes("gala") || title.includes("fuji") || title.includes("green apple") || title.includes("red apple") || title.includes("yellow") || title.includes("red delicious") || title.includes("pink lady") || title.includes("red cherry") || title.includes("red usa") || title.includes("usa red") || title.includes("china fuji")) &&
      !title.includes("juice") && !title.includes("drink") && !title.includes("nectar") && !title.includes("squash") && !title.includes("concentrate") && !title.includes("sparkling") && !title.includes("energy") && !title.includes("museli") && !title.includes("muesli") && !title.includes("jelly") && !title.includes("sauce") && !title.includes("can") && !title.includes("bottle") && !title.includes("tetra") && !title.includes("vibe") && !title.includes("yeti") && !title.includes("pfanner") && !title.includes("kist") && !title.includes("barbican") && !title.includes("bebo") && !title.includes("motha") && !title.includes("nutrinnovate") && !title.includes("sunquick") && !title.includes("smak");

    if (isRawFreshApple || title === "apple - red" || title === "apple - green" || title === "apple - yellow" || title === "apple - fuji" || title === "green apple" || title === "royal gala apple" || title === "usa red apple" || title === "red apple, 3's (about 500g)") {
      newIngId = appleId;
      categoryNote = "Fresh Raw Apple Fruit";
      rawAppleCount++;
    } else if (title.includes("muesli") || title.includes("museli")) {
      newIngId = muesliId;
      categoryNote = "Breakfast Cereal Muesli";
      remappedCount++;
    } else if (title.includes("sauce")) {
      newIngId = appleSauceId;
      categoryNote = "Apple Sauce Condiment";
      remappedCount++;
    } else if (title.includes("jelly")) {
      newIngId = appleJellyId;
      categoryNote = "Apple Flavoured Jelly Dessert";
      remappedCount++;
    } else if (title.includes("energy") || title.includes("yeti")) {
      newIngId = energyDrinkId;
      categoryNote = "Energy Beverage";
      remappedCount++;
    } else if (title.includes("squash") || title.includes("concentrate")) {
      newIngId = fruitSquashId;
      categoryNote = "Fruit Beverage Squash Concentrate";
      remappedCount++;
    } else if (title.includes("sparkling") || title.includes("kizz") || title.includes("barbican")) {
      newIngId = softDrinkId;
      categoryNote = "Flavored Carbonated Soft Drink";
      remappedCount++;
    } else {
      newIngId = appleJuiceId;
      categoryNote = "Apple Juice / Nectar Beverage";
      remappedCount++;
    }

    updates.push({
      productId: row.product_id,
      sourceId: row.source_id,
      ingredientId: newIngId,
      note: categoryNote,
    });
  }

  // Instant Batch Upsert Query
  if (updates.length > 0) {
    const query = sql`
      INSERT INTO ${mappings} (id, product_id, source_id, matched_ingredients, confidence, method, notes, meta, created_at, updated_at)
      VALUES ${sql.join(
        updates.map(
          (u) =>
            sql`(gen_random_uuid(), ${u.productId}::uuid, ${u.sourceId}::uuid, ARRAY[${u.ingredientId}::uuid], 1.00, 'human_expert_curation', ${u.note}, '{"isFood": true}'::jsonb, NOW(), NOW())`
        ),
        sql`, `
      )}
      ON CONFLICT (product_id, source_id)
      DO UPDATE SET 
        matched_ingredients = EXCLUDED.matched_ingredients,
        confidence = EXCLUDED.confidence,
        method = EXCLUDED.method,
        notes = EXCLUDED.notes,
        updated_at = NOW();
    `;
    await db.execute(query);
  }

  console.log(`\n✅ Cleaned Mappings:`);
  console.log(`   • Kept in Raw 'apple' (Fresh Fruit)  : ${rawAppleCount}`);
  console.log(`   • Remapped to Specific Beverages/Foods: ${remappedCount}`);

  // Query database to verify final raw 'apple' list
  const verifiedRawApples = await db.execute(sql`
    SELECT p.name, ps.name as store, p.price, m.notes
    FROM ${mappings} m
    JOIN ${products} p ON m.product_id = p.id
    JOIN ${priceSources} ps ON p.source_id = ps.id
    WHERE ${appleId}::uuid = ANY(m.matched_ingredients)
    ORDER BY p.name;
  `);

  console.log("\n==========================================================================================");
  console.log(`🍎 VERIFIED CLEAN RESULT SET FOR CANONICAL FRESH 'APPLE' (${verifiedRawApples.length} ITEMS):`);
  console.log("==========================================================================================");
  let idx = 1;
  for (const row of verifiedRawApples) {
    console.log(` ${String(idx).padStart(2)}. [${String(row.store).padEnd(8)}] LKR ${Number(row.price).toFixed(2).padStart(7)} | "${row.name}"`);
    idx++;
  }
}

cleanRawAppleMappings().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
