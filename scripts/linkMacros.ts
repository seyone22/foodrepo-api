import dotenv from "dotenv";
import { eq, isNull } from "drizzle-orm";

dotenv.config({ path: ".env.local" });

// Simple text-matching helper to associate a local ingredient to a USDA food description
function findBestUSDAFoodMatch(
  localName: string,
  usdaFoods: any[],
): any | null {
  const cleanLocal = localName.toLowerCase().trim();

  // 1. Direct match or alias match
  let bestMatch = usdaFoods.find((f) => {
    const desc = f?.description?.toLowerCase();
    if (!desc) return false;
    // Exact match or matches with comma details (e.g. "hummus" matching "hummus, commercial")
    return (
      desc === cleanLocal ||
      desc.startsWith(cleanLocal + ",") ||
      desc.endsWith(", " + cleanLocal)
    );
  });

  if (bestMatch) return bestMatch;

  // 2. Keyword check (e.g. local "green bean" matching "beans, snap, green...")
  const localWords = cleanLocal.split(/\s+/).filter((w) => w.length > 2);
  if (localWords.length > 0) {
    // Find USDA foods that contain all keywords
    const matches = usdaFoods.filter((f) => {
      const desc = f?.description?.toLowerCase();
      if (!desc) return false;
      return localWords.every((word) => desc.includes(word));
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Pick the one with the shortest description (closest match)
      return matches.sort(
        (a, b) => (a?.description?.length || 0) - (b?.description?.length || 0),
      )[0];
    }
  }

  return null;
}

async function main() {
  // Load database dynamically
  const { db } = await import("@/utils/db");
  const { ingredients, usdaFoods } = await import("@/utils/schema");

  // Load USDA Foods from Database
  console.log("Fetching USDA reference foods from database...");
  const referenceFoods = await db
    .select({
      fdcId: usdaFoods.fdcId,
      description: usdaFoods.description,
      caloriesKcal: usdaFoods.caloriesKcal,
      proteinG: usdaFoods.proteinG,
      fatG: usdaFoods.fatG,
      carbsG: usdaFoods.carbsG,
    })
    .from(usdaFoods);
  console.log(
    `Loaded ${referenceFoods.length} reference foods from PostgreSQL.`,
  );

  if (referenceFoods.length === 0) {
    console.error(
      "❌ No reference foods found in 'usda_foods'. Did you run 'seedUsdaFoods.ts'?",
    );
    return;
  }

  // Load Local Unmapped Ingredients
  console.log("Fetching unmapped ingredients from local database...");
  const localIngredients = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(isNull(ingredients.fdcId));
  console.log(`Loaded ${localIngredients.length} unmapped ingredients.`);

  console.log("\nMatching ingredients and linking to USDA database...");
  let matchCount = 0;

  for (const local of localIngredients) {
    const usdaMatch = findBestUSDAFoodMatch(local.name, referenceFoods);

    if (usdaMatch) {
      matchCount++;
      console.log(
        `✅ [${matchCount}] Linking "${local.name}" ➔ "${usdaMatch.description}" (FDC ID: ${usdaMatch.fdcId})`,
      );

      try {
        await db
          .update(ingredients)
          .set({
            fdcId: usdaMatch.fdcId,
            lastModified: new Date(),
          })
          .where(eq(ingredients.id, local.id));
      } catch (err: any) {
        console.error(`❌ Failed to link "${local.name}":`, err.message || err);
      }
    }
  }

  console.log(`\n🎉 Linking completed! Linked ${matchCount} new ingredients.`);
}

main().catch(console.error);
