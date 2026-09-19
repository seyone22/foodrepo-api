import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, products, mappings, priceSources } from "../src/utils/schema";
import { eq, ilike, sql } from "drizzle-orm";

async function inspectAndFixOliveOil() {
  console.log("🔍 Searching for 'Olive Oil' Ingredients & Products in PostgreSQL...\n");

  // 1. Search for Olive Oil ingredient in DB
  const oliveOilIngs = await db
    .select({ id: ingredients.id, name: ingredients.name, aliases: ingredients.aliases })
    .from(ingredients)
    .where(ilike(ingredients.name, "%olive%oil%"));

  console.log("📌 Existing Olive Oil Canonical Ingredients in DB:", oliveOilIngs);

  let oliveOilId: string;

  if (oliveOilIngs.length === 0) {
    console.log("⚠️ No 'olive oil' ingredient found. Creating canonical ingredient 'olive oil'...");
    const created = await db
      .insert(ingredients)
      .values({
        name: "olive oil",
        aliases: ["extra virgin olive oil", "pure olive oil", "pomace olive oil", "evoo"],
        provenance: "EXPERT_CURATION_FIX",
      })
      .returning({ id: ingredients.id });
    oliveOilId = created[0].id;
    console.log(`✅ Created canonical 'olive oil' ingredient with ID: ${oliveOilId}`);
  } else {
    oliveOilId = oliveOilIngs[0].id;
    console.log(`✅ Found canonical 'olive oil' ingredient with ID: ${oliveOilId}`);
  }

  // 2. Find all Olive Oil products across supermarkets
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

  console.log(`\n📦 Found ${oliveOilProducts.length} Olive Oil products in Supermarket DB:\n`);

  const updates: any[] = [];
  let idx = 1;
  for (const p of oliveOilProducts) {
    console.log(` ${String(idx).padStart(2)}. [${p.sourceName.padEnd(8)}] LKR ${Number(p.price).toFixed(2).padStart(8)} | "${p.name}" (ID: ${p.id})`);

    updates.push({
      productId: p.id,
      sourceId: p.sourceId,
      ingredientId: oliveOilId,
      note: "Extra Virgin / Pure / Pomace Olive Oil Product",
    });
    idx++;
  }

  // 3. Map all Olive Oil products directly to canonical oliveOilId in PostgreSQL
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
    console.log(`\n🎉 Successfully mapped all ${updates.length} Olive Oil products to 'olive oil' (ID: ${oliveOilId}) in PostgreSQL!`);
  }

  // 4. Verify DB output
  const verified = await db.execute(sql`
    SELECT p.name, ps.name as store, p.price, m.confidence, m.method
    FROM ${mappings} m
    JOIN ${products} p ON m.product_id = p.id
    JOIN ${priceSources} ps ON p.source_id = ps.id
    WHERE ${oliveOilId}::uuid = ANY(m.matched_ingredients)
    ORDER BY p.name;
  `);

  console.log("\n==========================================================================================");
  console.log(`🫒 VERIFIED PRODUCTION MAPPING RESULT SET FOR 'OLIVE OIL' (${verified.length} ITEMS):`);
  console.log("==========================================================================================");
  idx = 1;
  for (const row of verified) {
    console.log(` ${String(idx).padStart(2)}. [${String(row.store).padEnd(8)}] LKR ${Number(row.price).toFixed(2).padStart(8)} | "${row.name}"`);
    idx++;
  }
}

inspectAndFixOliveOil().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
