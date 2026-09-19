import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings, products, priceSources } from "../src/utils/schema";
import { eq, sql } from "drizzle-orm";

async function mapAllOliveOilsCorrectly() {
  console.log("🫒 Mapping All Supermarket Olive Oils to Canonical 'olive oil'...\n");

  // Fetch canonical 'olive oil' ingredient ID (name: 'olive oil')
  const oliveOilIng = await db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(eq(ingredients.name, "olive oil"));

  let oliveOilId: string;
  if (oliveOilIng.length === 0) {
    const created = await db
      .insert(ingredients)
      .values({
        name: "olive oil",
        aliases: ["extra virgin olive oil", "pure olive oil", "pomace olive oil", "evoo"],
        provenance: "EXPERT_CURATION_FIX",
      })
      .returning({ id: ingredients.id });
    oliveOilId = created[0].id;
  } else {
    oliveOilId = oliveOilIng[0].id;
  }

  console.log(`📌 Canonical 'olive oil' Ingredient ID: ${oliveOilId}`);

  // Fetch all olive oil products in DB
  const oliveOilProducts = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      sourceId: products.sourceId,
      sourceName: priceSources.name,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
    .where(sql`${products.name} ILIKE '%olive%oil%' OR ${products.name} ILIKE '%extra virgin olive%' OR ${products.name} ILIKE '%pomace olive%'`);

  const updates: any[] = [];
  let foodCount = 0;
  let nonFoodCount = 0;

  for (const p of oliveOilProducts) {
    const title = p.name.toLowerCase();

    // Check if it's soap or baby cream
    if (title.includes("soap") || title.includes("baby cream") || title.includes("body wash")) {
      nonFoodCount++;
      updates.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[]::uuid[]`,
        note: "Non-Food Soap / Baby Cream SKU",
        isFood: false,
      });
    } else {
      foodCount++;
      updates.push({
        productId: p.id,
        sourceId: p.sourceId,
        matchedIngredients: sql`ARRAY[${oliveOilId}::uuid]`,
        note: "Pure / Extra Virgin / Pomace Olive Oil Cooking Oil",
        isFood: true,
      });
    }
  }

  // Execute batch upsert
  if (updates.length > 0) {
    const query = sql`
      INSERT INTO ${mappings} (id, product_id, source_id, matched_ingredients, confidence, method, notes, meta, created_at, updated_at)
      VALUES ${sql.join(
        updates.map(
          (u) =>
            sql`(gen_random_uuid(), ${u.productId}::uuid, ${u.sourceId}::uuid, ${u.matchedIngredients}, 1.00, 'human_expert_curation', ${u.note}, ${JSON.stringify({ isFood: u.isFood })}::jsonb, NOW(), NOW())`
        ),
        sql`, `
      )}
      ON CONFLICT (product_id, source_id)
      DO UPDATE SET 
        matched_ingredients = EXCLUDED.matched_ingredients,
        confidence = EXCLUDED.confidence,
        method = EXCLUDED.method,
        notes = EXCLUDED.notes,
        meta = EXCLUDED.meta,
        updated_at = NOW();
    `;
    await db.execute(query);
  }

  console.log(`✅ Processed ${oliveOilProducts.length} items: ${foodCount} cooking oils mapped, ${nonFoodCount} non-food soaps filtered.`);

  // Query database to verify final olive oil list
  const verified = await db.execute(sql`
    SELECT p.name, ps.name as store, p.price
    FROM ${mappings} m
    JOIN ${products} p ON m.product_id = p.id
    JOIN ${priceSources} ps ON p.source_id = ps.id
    WHERE ${oliveOilId}::uuid = ANY(m.matched_ingredients)
    ORDER BY p.name;
  `);

  console.log("\n==========================================================================================");
  console.log(`🫒 VERIFIED PRODUCTION RESULT SET FOR CANONICAL 'OLIVE OIL' (${verified.length} ITEMS):`);
  console.log("==========================================================================================");
  let idx = 1;
  for (const row of verified) {
    console.log(` ${String(idx).padStart(2)}. [${String(row.store).padEnd(8)}] LKR ${Number(row.price).toFixed(2).padStart(8)} | "${row.name}"`);
    idx++;
  }
}

mapAllOliveOilsCorrectly().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
