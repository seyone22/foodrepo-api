import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients } from "../src/utils/schema";
import { sql, isNotNull } from "drizzle-orm";

async function checkIngredientsDb() {
  console.log("🔍 Checking canonical ingredients database status...");

  const [{ count: totalIng }] = await db.select({ count: sql<number>`count(*)` }).from(ingredients);
  const [{ count: withEmbedding }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(ingredients)
    .where(isNotNull(ingredients.embedding));

  console.log(`   • Total Ingredients: ${totalIng}`);
  console.log(`   • Ingredients with Vector Embedding: ${withEmbedding}`);

  // Fetch sample ingredients
  const samples = await db
    .select({ id: ingredients.id, name: ingredients.name, fdcId: ingredients.fdcId })
    .from(ingredients)
    .limit(10);

  console.log("\n📌 Sample Ingredients:");
  console.table(samples);
}

checkIngredientsDb()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
