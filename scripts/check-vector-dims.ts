import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkVector() {
  const { db } = await import("@/utils/db");
  const { sql } = await import("drizzle-orm");

  const check = await db.execute(sql`
    SELECT 
      count(*) as total_ingredients,
      count(embedding) as with_embedding,
      (SELECT count(*) FROM foodrepo.ingredients WHERE embedding IS NOT NULL AND vector_dims(embedding) = 1536) as dims_1536,
      (SELECT count(*) FROM foodrepo.ingredients WHERE embedding IS NOT NULL AND vector_dims(embedding) = 3072) as dims_3072
    FROM foodrepo.ingredients;
  `);

  console.log("Vector counts:", check);
  process.exit(0);
}

checkVector().catch(console.error);
