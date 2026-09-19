import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: ".env.local" });

async function main() {
  try {
    const { db } = await import("@/utils/db");
    const { ingredients } = await import("@/utils/schema");

    const allIngs = await db
      .select({ id: ingredients.id, name: ingredients.name })
      .from(ingredients);
    console.log(`Total ingredients in local database: ${allIngs.length}`);
    console.log("\nFirst 20 ingredients:");
    allIngs.slice(0, 20).forEach((ing, i) => {
      console.log(`${i + 1}. [ID: ${ing.id}] ${ing.name}`);
    });
  } catch (err) {
    console.error("Error fetching ingredients:", err);
  }
}

main().catch(console.error);
