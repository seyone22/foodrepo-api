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
  console.log(
    "Adding claimed_until columns and ingredient_redirects table...",
  );

  try {
    await sql.begin(async (tx: any) => {
      await tx`
        ALTER TABLE foodrepo.ingredients
        ADD COLUMN IF NOT EXISTS claimed_until timestamp;
      `;

      await tx`
        CREATE INDEX IF NOT EXISTS idx_ingredients_claimed_until
        ON foodrepo.ingredients (claimed_until);
      `;

      await tx`
        ALTER TABLE foodrepo.products
        ADD COLUMN IF NOT EXISTS claimed_until timestamp;
      `;

      await tx`
        CREATE INDEX IF NOT EXISTS idx_products_claimed_until
        ON foodrepo.products (claimed_until);
      `;

      await tx`
        CREATE TABLE IF NOT EXISTS foodrepo.ingredient_redirects (
          source_id uuid PRIMARY KEY,
          target_id uuid NOT NULL REFERENCES foodrepo.ingredients(id) ON DELETE CASCADE,
          source_name text,
          merged_at timestamp DEFAULT now() NOT NULL
        );
      `;

      await tx`
        CREATE INDEX IF NOT EXISTS idx_ingredient_redirects_target_id
        ON foodrepo.ingredient_redirects (target_id);
      `;
    });

    console.log("Migration completed successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
