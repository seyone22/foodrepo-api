import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { ingredients } from "@/utils/schema";
import { sql, isNotNull } from "drizzle-orm";

async function inspectIngredients() {
  console.log("==========================================");
  console.log("🔬 MASTER INGREDIENT DEEP FIELD INSPECTION");
  console.log("==========================================\n");

  const samplePopulated = await db
    .select()
    .from(ingredients)
    .limit(5);

  console.log("--- Sample Master Ingredient Records ---");
  for (const item of samplePopulated) {
    console.log(`ID: ${item.id}`);
    console.log(`Name: ${item.name}`);
    console.log(`Aliases: ${JSON.stringify(item.aliases)}`);
    console.log(`Country: ${JSON.stringify(item.country)}`);
    console.log(`Cuisine: ${JSON.stringify(item.cuisine)}`);
    console.log(`Region: ${JSON.stringify(item.region)}`);
    console.log(`FlavorProfile: ${JSON.stringify(item.flavorProfile)}`);
    console.log(`DietaryFlags: ${JSON.stringify(item.dietaryFlags)}`);
    console.log(`Provenance: ${item.provenance}`);
    console.log(`FDC ID: ${item.fdcId}`);
    console.log(`Image: ${JSON.stringify(item.image)}`);
    console.log(`Pronunciation: ${item.pronunciation}`);
    console.log(`Comment: ${item.comment}`);
    console.log(`PartOf: ${JSON.stringify(item.partOf)}`);
    console.log(`Derivatives: ${JSON.stringify(item.derivatives)}`);
    console.log(`Varieties: ${JSON.stringify(item.varieties)}`);
    console.log(`UsedIn: ${JSON.stringify(item.usedIn)}`);
    console.log(`Substitutes: ${JSON.stringify(item.substitutes)}`);
    console.log(`PairsWith: ${JSON.stringify(item.pairsWith)}`);
    console.log("------------------------------------------");
  }

  // Value frequency distribution check
  const fdcLinked = await db
    .select({ count: sql<number>`count(*)` })
    .from(ingredients)
    .where(isNotNull(ingredients.fdcId));

  const imagePresent = await db
    .select({ count: sql<number>`count(*)` })
    .from(ingredients)
    .where(sql`(${ingredients.image}->>'missing')::boolean IS FALSE OR ${ingredients.image}->>'url' IS NOT NULL`);

  const aliasesPresent = await db
    .select({ count: sql<number>`count(*)` })
    .from(ingredients)
    .where(sql`array_length(${ingredients.aliases}, 1) > 0`);

  const dietaryPresent = await db
    .select({ count: sql<number>`count(*)` })
    .from(ingredients)
    .where(sql`array_length(${ingredients.dietaryFlags}, 1) > 0`);

  console.log(`\nMetrics Summary:`);
  console.log(`• FDC Linked: ${fdcLinked[0].count}`);
  console.log(`• Images Present: ${imagePresent[0].count}`);
  console.log(`• Aliases Present: ${aliasesPresent[0].count}`);
  console.log(`• Dietary Flags Present: ${dietaryPresent[0].count}`);
}

inspectIngredients()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
