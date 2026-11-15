const postgres = require("postgres");
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set in environment.");
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: "require", max: 1 });

interface IngredientLink {
  id: string | null;
  name: string;
}

function resolveLinkArray(
  arr: any,
  nameToRecord: Map<string, { id: string; name: string }>,
): { updated: IngredientLink[]; changed: boolean; resolved: number; unresolved: number } {
  if (!Array.isArray(arr) || arr.length === 0) {
    return { updated: [], changed: false, resolved: 0, unresolved: 0 };
  }

  let changed = false;
  let resolved = 0;
  let unresolved = 0;
  const seen = new Set<string>();
  const updated: IngredientLink[] = [];

  for (const item of arr) {
    const rawName = typeof item === "string" ? item : item?.name;
    const trimmed = String(rawName || "").trim();
    if (!trimmed) continue;

    let id: string | null = typeof item === "object" && item?.id ? item.id : null;
    let name = trimmed;

    if (!id) {
      const match = nameToRecord.get(trimmed.toLowerCase());
      if (match) {
        id = match.id;
        name = match.name;
        changed = true;
      }
    }

    if (id) resolved++;
    else unresolved++;

    const dedupeKey = id ? `id:${id}` : `name:${name.toLowerCase()}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      updated.push({ id, name });
    } else {
      changed = true;
    }
  }

  return { updated, changed, resolved, unresolved };
}

async function migrate() {
  console.log("Starting migration: link columns text[] -> jsonb + ID backfill...");

  try {
    // 1. Check column types and alter any text[] columns to jsonb atomically
    const colTypes = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'foodrepo'
        AND table_name = 'ingredients'
        AND column_name IN ('part_of', 'varieties', 'substitutes', 'pairs_with')
    `;

    const colsToConvert = colTypes
      .filter((c: any) => c.data_type === "ARRAY")
      .map((c: any) => c.column_name);

    if (colsToConvert.length > 0) {
      console.log(`Converting text[] columns to jsonb: ${colsToConvert.join(", ")}`);
      await sql.begin(async (tx: any) => {
        await tx`
          CREATE OR REPLACE FUNCTION foodrepo.temp_convert_links_to_jsonb(arr text[])
          RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
            SELECT COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', null,
                    'name', elem
                  )
                )
                FROM unnest(arr) AS elem
                WHERE elem IS NOT NULL AND btrim(elem) <> ''
              ),
              '[]'::jsonb
            );
          $$;
        `;

        for (const col of colsToConvert) {
          if (col === "part_of") {
            await tx`DROP INDEX IF EXISTS foodrepo.idx_ingredients_part_of_gin;`;
            await tx`
              ALTER TABLE foodrepo.ingredients
              ALTER COLUMN part_of TYPE jsonb
              USING foodrepo.temp_convert_links_to_jsonb(part_of);
            `;
            await tx`ALTER TABLE foodrepo.ingredients ALTER COLUMN part_of SET DEFAULT '[]'::jsonb;`;
            await tx`CREATE INDEX idx_ingredients_part_of_gin ON foodrepo.ingredients USING gin (part_of);`;
          } else if (col === "varieties") {
            await tx`
              ALTER TABLE foodrepo.ingredients
              ALTER COLUMN varieties TYPE jsonb
              USING foodrepo.temp_convert_links_to_jsonb(varieties);
            `;
            await tx`ALTER TABLE foodrepo.ingredients ALTER COLUMN varieties SET DEFAULT '[]'::jsonb;`;
          } else if (col === "substitutes") {
            await tx`
              ALTER TABLE foodrepo.ingredients
              ALTER COLUMN substitutes TYPE jsonb
              USING foodrepo.temp_convert_links_to_jsonb(substitutes);
            `;
            await tx`ALTER TABLE foodrepo.ingredients ALTER COLUMN substitutes SET DEFAULT '[]'::jsonb;`;
          } else if (col === "pairs_with") {
            await tx`
              ALTER TABLE foodrepo.ingredients
              ALTER COLUMN pairs_with TYPE jsonb
              USING foodrepo.temp_convert_links_to_jsonb(pairs_with);
            `;
            await tx`ALTER TABLE foodrepo.ingredients ALTER COLUMN pairs_with SET DEFAULT '[]'::jsonb;`;
          }
        }

        await tx`DROP FUNCTION foodrepo.temp_convert_links_to_jsonb(text[]);`;
      });
      console.log("Column alterations completed.");
    } else {
      console.log("All 4 link columns are already jsonb. Proceeding to ID backfill...");
    }

    // 2. Load all ingredients for ID resolution
    const allRows = await sql`
      SELECT id, name, part_of, varieties, substitutes, pairs_with, derivatives
      FROM foodrepo.ingredients
    `;
    console.log(`Loaded ${allRows.length} ingredients from database.`);

    const nameToRecord = new Map<string, { id: string; name: string }>();
    for (const r of allRows) {
      if (r.name) {
        nameToRecord.set(String(r.name).trim().toLowerCase(), {
          id: r.id,
          name: r.name,
        });
      }
    }

    const stats = {
      rowsUpdated: 0,
      partOf: { resolved: 0, unresolved: 0 },
      varieties: { resolved: 0, unresolved: 0 },
      substitutes: { resolved: 0, unresolved: 0 },
      pairsWith: { resolved: 0, unresolved: 0 },
      derivatives: { resolved: 0, unresolved: 0 },
    };

    // 3. Batch update rows with resolved IDs
    const updates: Array<{
      id: string;
      part_of: any;
      varieties: any;
      substitutes: any;
      pairs_with: any;
      derivatives: any;
    }> = [];

    for (const row of allRows) {
      const p = resolveLinkArray(row.part_of, nameToRecord);
      const v = resolveLinkArray(row.varieties, nameToRecord);
      const s = resolveLinkArray(row.substitutes, nameToRecord);
      const pw = resolveLinkArray(row.pairs_with, nameToRecord);

      stats.partOf.resolved += p.resolved;
      stats.partOf.unresolved += p.unresolved;
      stats.varieties.resolved += v.resolved;
      stats.varieties.unresolved += v.unresolved;
      stats.substitutes.resolved += s.resolved;
      stats.substitutes.unresolved += s.unresolved;
      stats.pairsWith.resolved += pw.resolved;
      stats.pairsWith.unresolved += pw.unresolved;

      let derivChanged = false;
      const updatedDerivs = Array.isArray(row.derivatives)
        ? row.derivatives.map((d: any) => {
            if (!d) return d;
            if (d.targetId) {
              stats.derivatives.resolved++;
              return d;
            }
            const dName = String(d.name || "").trim().toLowerCase();
            const match = dName ? nameToRecord.get(dName) : undefined;
            if (match) {
              stats.derivatives.resolved++;
              derivChanged = true;
              return { ...d, targetId: match.id };
            }
            stats.derivatives.unresolved++;
            return d;
          })
        : [];

      if (p.changed || v.changed || s.changed || pw.changed || derivChanged) {
        updates.push({
          id: row.id,
          part_of: p.updated,
          varieties: v.updated,
          substitutes: s.updated,
          pairs_with: pw.updated,
          derivatives: updatedDerivs,
        });
      }
    }

    console.log(`Applying ID backfill to ${updates.length} rows...`);
    const BATCH_SIZE = 250;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      await sql.begin(async (tx: any) => {
        for (const u of batch) {
          await tx`
            UPDATE foodrepo.ingredients
            SET
              part_of = ${tx.json(u.part_of)},
              varieties = ${tx.json(u.varieties)},
              substitutes = ${tx.json(u.substitutes)},
              pairs_with = ${tx.json(u.pairs_with)},
              derivatives = ${tx.json(u.derivatives)},
              updated_at = NOW()
            WHERE id = ${u.id}
          `;
        }
      });
      stats.rowsUpdated += batch.length;
      if ((i + BATCH_SIZE) % 2500 === 0 || i + BATCH_SIZE >= updates.length) {
        console.log(`Updated ${stats.rowsUpdated}/${updates.length} rows...`);
      }
    }

    console.log("Migration & ID backfill completed successfully:");
    console.log(JSON.stringify(stats, null, 2));
  } catch (err: any) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
