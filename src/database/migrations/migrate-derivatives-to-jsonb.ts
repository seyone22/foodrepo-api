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

async function migrate() {
  console.log("Starting migration: derivatives text[] -> jsonb...");

  try {
    const [initialCount] = await sql`
      SELECT count(*)::int as count 
      FROM foodrepo.ingredients 
      WHERE derivatives IS NOT NULL AND array_length(derivatives, 1) > 0
    `;
    console.log(`Found ${initialCount.count} records with non-empty text[] derivatives.`);

    console.log("Executing atomic column alteration via helper function...");
    await sql.begin(async (tx: any) => {
      await tx`
        CREATE OR REPLACE FUNCTION foodrepo.temp_convert_derivatives_to_jsonb(arr text[])
        RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
          SELECT COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'name', d,
                  'process', null,
                  'yieldRatio', null,
                  'lossRatio', null,
                  'targetId', null
                )
              )
              FROM unnest(arr) AS d
            ),
            '[]'::jsonb
          );
        $$;
      `;

      await tx`
        ALTER TABLE foodrepo.ingredients
        ALTER COLUMN derivatives TYPE jsonb
        USING foodrepo.temp_convert_derivatives_to_jsonb(derivatives);
      `;

      await tx`
        ALTER TABLE foodrepo.ingredients 
        ALTER COLUMN derivatives SET DEFAULT '[]'::jsonb;
      `;

      await tx`
        DROP FUNCTION foodrepo.temp_convert_derivatives_to_jsonb(text[]);
      `;
    });

    console.log("Column alteration completed successfully.");

    // Verification
    const [migratedCount] = await sql`
      SELECT count(*)::int as count 
      FROM foodrepo.ingredients 
      WHERE derivatives IS NOT NULL AND jsonb_array_length(derivatives) > 0
    `;
    console.log(`Verification: ${migratedCount.count} records now have non-empty JSONB derivatives.`);

    const sample = await sql`
      SELECT name, derivatives 
      FROM foodrepo.ingredients 
      WHERE name = 'pumpkin' 
      LIMIT 1
    `;
    console.log("Sample migrated record (pumpkin):", JSON.stringify(sample[0], null, 2));

    if (migratedCount.count !== initialCount.count) {
      throw new Error(`Integrity check failed: expected ${initialCount.count} rows, got ${migratedCount.count}`);
    }

    console.log("Migration completed with zero data loss.");
  } catch (err: any) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
