import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { eq, inArray } from "drizzle-orm";

const UNCOUNTABLE_FOODS = new Set([
  "rice", "flour", "sugar", "salt", "water", "milk", "butter", "cheese",
  "oil", "vinegar", "honey", "meat", "beef", "pork", "mutton", "lamb",
  "chicken", "fish", "bread", "pepper", "turmeric", "garlic", "ginger",
  "mustard", "cinnamon", "cardamom", "clove", "saffron", "yeast", "cornstarch",
  "pasta", "spaghetti", "macaroni", "noodle", "sauce", "syrup", "jam", "jelly"
]);

const IRREGULAR_PLURALS: Record<string, string> = {
  "tomatoes": "tomato", "potatoes": "potato", "mangoes": "mango", "cherries": "cherry",
  "berries": "berry", "strawberries": "strawberry", "blueberries": "blueberry",
  "raspberries": "raspberry", "blackberries": "blackberry", "cranberries": "cranberry",
  "chillies": "chilli", "chilis": "chilli", "leaves": "leaf", "loaves": "loaf",
  "halves": "half", "radishes": "radish", "peaches": "peach", "spices": "spice",
  "herbs": "herb", "olives": "olive", "onions": "onion", "lemons": "lemon",
  "limes": "lime", "apples": "apple", "oranges": "orange", "bananas": "banana",
  "pears": "pear", "grapes": "grape", "figs": "fig", "dates": "date",
  "nuts": "nut", "walnuts": "walnut", "almonds": "almond", "cashews": "cashew",
  "peanuts": "peanut", "pistachios": "pistachio", "carrots": "carrot",
  "cucumbers": "cucumber", "zucchinis": "zucchini", "courgettes": "courgette",
  "eggplants": "eggplant", "aubergines": "aubergine", "capsicums": "capsicum",
  "peppers": "pepper", "mushrooms": "mushroom", "beans": "bean", "peas": "pea",
  "lentils": "lentil", "chickpeas": "chickpea", "cloves": "clove",
  "seeds": "seed", "eggs": "egg", "sausages": "sausage"
};

function getSingularForm(word: string): { singular: string; isPluralPattern: boolean } {
  const w = word.toLowerCase().trim();
  if (UNCOUNTABLE_FOODS.has(w)) return { singular: w, isPluralPattern: false };
  if (IRREGULAR_PLURALS[w]) return { singular: IRREGULAR_PLURALS[w], isPluralPattern: true };
  if (w.endsWith("ies") && w.length > 4) return { singular: w.slice(0, -3) + "y", isPluralPattern: true };
  if (w.endsWith("es") && (w.endsWith("shes") || w.endsWith("ches") || w.endsWith("xes") || w.endsWith("sses"))) {
    return { singular: w.slice(0, -2), isPluralPattern: true };
  }
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is") && w.length > 3) {
    return { singular: w.slice(0, -1), isPluralPattern: true };
  }
  return { singular: w, isPluralPattern: false };
}

function mergeArrays(...arrays: (string[] | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const arr of arrays) {
    if (arr) {
      for (const item of arr) {
        if (item && item.trim()) set.add(item.trim());
      }
    }
  }
  return Array.from(set);
}

async function runNormalization() {
  const isDryRun = process.argv.includes("--dry-run");
  console.log(`🚀 Starting Fast Parallel Ingredient Normalization ${isDryRun ? "[DRY RUN MODE]" : "[LIVE DATABASE MODE]"}...\n`);

  const allIngredients = await db.select().from(ingredients);
  console.log(`📦 Loaded ${allIngredients.length} ingredients from database.`);

  const singularMap = new Map<string, typeof ingredients.$inferSelect>();
  const pluralMap = new Map<string, typeof ingredients.$inferSelect>();

  for (const ing of allIngredients) {
    const clean = ing.name.toLowerCase().trim();
    const { singular, isPluralPattern } = getSingularForm(clean);

    if (isPluralPattern || clean !== singular) {
      pluralMap.set(singular, ing);
    } else {
      singularMap.set(singular, ing);
    }
  }

  const collidingPairs: Array<{
    baseKey: string;
    singularIng: typeof ingredients.$inferSelect;
    pluralIng: typeof ingredients.$inferSelect;
  }> = [];

  const replacementMap = new Map<string, string>(); // pluralId -> singularId
  const pluralIdsToDelete: string[] = [];

  for (const [key, singularIng] of singularMap.entries()) {
    if (pluralMap.has(key)) {
      const pluralIng = pluralMap.get(key)!;
      collidingPairs.push({ baseKey: key, singularIng, pluralIng });
      replacementMap.set(pluralIng.id, singularIng.id);
      pluralIdsToDelete.push(pluralIng.id);
    }
  }

  console.log(`⚡ Identified ${collidingPairs.length} colliding singular/plural pairs to merge.\n`);

  if (isDryRun) {
    console.log(`[DRY RUN] Would update ${collidingPairs.length} singular ingredients and delete ${pluralIdsToDelete.length} plural ingredients.`);
    process.exit(0);
  }

  // 1. Update Singular Ingredients in parallel chunks
  console.log(`🔄 Updating singular ingredients with merged metadata in parallel...`);
  const chunkSize = 25;
  for (let i = 0; i < collidingPairs.length; i += chunkSize) {
    const batch = collidingPairs.slice(i, i + chunkSize);
    await Promise.all(batch.map(async ({ singularIng, pluralIng }) => {
      const combinedAliases = mergeArrays(singularIng.aliases, pluralIng.aliases, [pluralIng.name]);
      const combinedVarieties = mergeArrays(singularIng.varieties, pluralIng.varieties);
      const combinedUsedIn = mergeArrays(singularIng.usedIn, pluralIng.usedIn);
      const combinedSubstitutes = mergeArrays(singularIng.substitutes, pluralIng.substitutes);
      const combinedPairsWith = mergeArrays(singularIng.pairsWith, pluralIng.pairsWith);
      const combinedCountry = mergeArrays(singularIng.country, pluralIng.country);
      const combinedCuisine = mergeArrays(singularIng.cuisine, pluralIng.cuisine);
      const combinedRegion = mergeArrays(singularIng.region, pluralIng.region);
      const combinedFlavorProfile = mergeArrays(singularIng.flavorProfile, pluralIng.flavorProfile);
      const combinedDietaryFlags = mergeArrays(singularIng.dietaryFlags, pluralIng.dietaryFlags);

      return db.update(ingredients)
        .set({
          aliases: combinedAliases,
          varieties: combinedVarieties,
          usedIn: combinedUsedIn,
          substitutes: combinedSubstitutes,
          pairsWith: combinedPairsWith,
          country: combinedCountry,
          cuisine: combinedCuisine,
          region: combinedRegion,
          flavorProfile: combinedFlavorProfile,
          dietaryFlags: combinedDietaryFlags,
          fdcId: singularIng.fdcId || pluralIng.fdcId,
          embedding: singularIng.embedding || pluralIng.embedding,
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, singularIng.id));
    }));
  }

  // 2. Update mappings table in bulk
  console.log(`🔗 Updating product mappings referencing merged plural IDs...`);
  const allMappings = await db.select({
    id: mappings.id,
    matchedIngredients: mappings.matchedIngredients
  }).from(mappings);

  let updatedMappingsCount = 0;
  for (const m of allMappings) {
    if (!m.matchedIngredients) continue;
    let needsUpdate = false;
    const newMatchedSet = new Set<string>();

    for (const ingId of m.matchedIngredients) {
      if (replacementMap.has(ingId)) {
        needsUpdate = true;
        newMatchedSet.add(replacementMap.get(ingId)!);
      } else {
        newMatchedSet.add(ingId);
      }
    }

    if (needsUpdate) {
      await db.update(mappings)
        .set({ matchedIngredients: Array.from(newMatchedSet) })
        .where(eq(mappings.id, m.id));
      updatedMappingsCount++;
    }
  }

  // 3. Delete plural ingredients in bulk batching
  console.log(`🗑️ Deleting ${pluralIdsToDelete.length} duplicate plural ingredient records...`);
  for (let i = 0; i < pluralIdsToDelete.length; i += chunkSize) {
    const chunk = pluralIdsToDelete.slice(i, i + chunkSize);
    await db.delete(ingredients).where(inArray(ingredients.id, chunk));
  }

  console.log("\n==================================================");
  console.log("          NORMALIZATION EXECUTION COMPLETE        ");
  console.log("==================================================");
  console.log(`Colliding Pairs Merged: ${collidingPairs.length}`);
  console.log(`Mappings Re-linked:     ${updatedMappingsCount}`);
  console.log(`Plural Records Deleted: ${pluralIdsToDelete.length}`);
  console.log("==================================================\n");
}

runNormalization()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error during normalization:", err);
    process.exit(1);
  });
