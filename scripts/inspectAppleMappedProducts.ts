import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings, products, priceSources } from "../src/utils/schema";
import { eq, sql } from "drizzle-orm";

async function inspectAppleMappedProducts() {
  const appleIng = await db.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.name, "apple"));
  if (appleIng.length === 0) {
    console.log("No 'apple' ingredient found.");
    return;
  }
  const appleId = appleIng[0].id;

  const rows = await db.execute(sql`
    SELECT p.id as product_id, p.source_id, p.name, ps.name as store, p.price, m.method, m.notes
    FROM ${mappings} m
    JOIN ${products} p ON m.product_id = p.id
    JOIN ${priceSources} ps ON p.source_id = ps.id
    WHERE ${appleId}::uuid = ANY(m.matched_ingredients)
    ORDER BY p.name;
  `);

  console.log(`Found ${rows.length} products currently mapped to raw 'apple':\n`);
  let idx = 1;
  for (const row of rows) {
    console.log(`${String(idx).padStart(3)}. [${String(row.store).padEnd(8)}] "${row.name}" (ID: ${row.product_id})`);
    idx++;
  }
}

inspectAppleMappedProducts();
