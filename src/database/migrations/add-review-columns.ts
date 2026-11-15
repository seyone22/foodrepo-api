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
  console.log("Adding review_status and review_reason columns to foodrepo.ingredients...");

  try {
    await sql.begin(async (tx: any) => {
      await tx`
        ALTER TABLE foodrepo.ingredients
        ADD COLUMN IF NOT EXISTS review_status text,
        ADD COLUMN IF NOT EXISTS review_reason text;
      `;

      await tx`
        CREATE INDEX IF NOT EXISTS idx_ingredients_review_status
        ON foodrepo.ingredients (review_status);
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
