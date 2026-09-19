import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { mappings } from "../src/utils/schema";
import { sql } from "drizzle-orm";

export interface ManualMappingEntry {
  productId: string;
  sourceId: string;
  ingredientId: string | null;
  note: string;
  isFood: boolean;
}

export async function saveManualMappings(entries: ManualMappingEntry[]) {
  if (entries.length === 0) return;

  const updateRows = entries.map((m) => {
    const ingArraySql = m.ingredientId
      ? sql`ARRAY[${m.ingredientId}::uuid]`
      : sql`ARRAY[]::uuid[]`;
    const metaJson = JSON.stringify({ isFood: m.isFood });

    return sql`(
      gen_random_uuid(),
      ${m.productId}::uuid,
      ${m.sourceId}::uuid,
      ${ingArraySql},
      1.00,
      'manual_expert_mapping',
      ${m.note},
      ${metaJson}::jsonb,
      NOW(),
      NOW()
    )`;
  });

  const query = sql`
    INSERT INTO ${mappings} (id, product_id, source_id, matched_ingredients, confidence, method, notes, meta, created_at, updated_at)
    VALUES ${sql.join(updateRows, sql`, `)}
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
  console.log(`✅ Successfully saved ${entries.length} manual mappings to database.`);
}
