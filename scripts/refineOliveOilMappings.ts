import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings, products, priceSources } from "../src/utils/schema";
import { eq, sql } from "drizzle-orm";

async function refineOliveOil() {
  const oliveOilIng = await db.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.name, "olive oil"));
  if (oliveOilIng.length === 0) return;
  const oliveOilId = oliveOilIng[0].id;

  // Unlink soaps, baby creams, body wash from olive oil
  await db.execute(sql`
    UPDATE ${mappings} m
    SET matched_ingredients = ARRAY[]::uuid[],
        method = 'human_manual_cleanup',
        notes = 'Non-Food Soap / Baby Cream SKU',
        meta = '{"isFood": false}'::jsonb,
        updated_at = NOW()
    FROM ${products} p
    WHERE m.product_id = p.id
      AND ${oliveOilId}::uuid = ANY(m.matched_ingredients)
      AND (p.name ILIKE '%soap%' OR p.name ILIKE '%cream%' OR p.name ILIKE '%body wash%');
  `);

  const verified = await db.execute(sql`
    SELECT p.name, ps.name as store, p.price
    FROM ${mappings} m
    JOIN ${products} p ON m.product_id = p.id
    JOIN ${priceSources} ps ON p.source_id = ps.id
    WHERE ${oliveOilId}::uuid = ANY(m.matched_ingredients)
    ORDER BY p.name;
  `);

  console.log("\n==========================================================================================");
  console.log(`🫒 VERIFIED CLEAN COOKING OLIVE OIL MAPPINGS (${verified.length} ITEMS):`);
  console.log("==========================================================================================");
  let idx = 1;
  for (const row of verified) {
    console.log(` ${String(idx).padStart(2)}. [${String(row.store).padEnd(8)}] LKR ${Number(row.price).toFixed(2).padStart(8)} | "${row.name}"`);
    idx++;
  }
}

refineOliveOil().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
