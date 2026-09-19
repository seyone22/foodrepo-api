import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });

const NUTRIENT_MAPPING = {
  calories: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  fiber: 1079,
  sodium: 1093,
  sugars: [1063, 2000],
};

interface NutrientValues {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  sodiumMg: number;
  sugarG: number;
}

function extractNutrients(foodNutrients: any[]): NutrientValues {
  const values: NutrientValues = {
    caloriesKcal: 0,
    proteinG: 0,
    fatG: 0,
    carbsG: 0,
    fiberG: 0,
    sodiumMg: 0,
    sugarG: 0,
  };

  for (const fn of foodNutrients) {
    const id = fn.nutrient?.id;
    const amount = fn.amount || 0;

    if (id === NUTRIENT_MAPPING.calories) values.caloriesKcal = amount;
    else if (id === NUTRIENT_MAPPING.protein) values.proteinG = amount;
    else if (id === NUTRIENT_MAPPING.fat) values.fatG = amount;
    else if (id === NUTRIENT_MAPPING.carbs) values.carbsG = amount;
    else if (id === NUTRIENT_MAPPING.fiber) values.fiberG = amount;
    else if (id === NUTRIENT_MAPPING.sodium) values.sodiumMg = amount;
    else if (NUTRIENT_MAPPING.sugars.includes(id)) values.sugarG = amount;
  }

  return values;
}

async function main() {
  const jsonPath = path.join(
    __dirname,
    "../public/FoodData_Central_sr_legacy_food_json_2018-04.json",
  );
  if (!fs.existsSync(jsonPath)) {
    console.error("USDA SR Legacy JSON file not found at:", jsonPath);
    return;
  }

  // Dynamic imports to ensure dotenv loads first
  const { db } = await import("@/utils/db");
  const { usdaFoods } = await import("@/utils/schema");

  console.log("Reading USDA SR Legacy JSON file...");
  const rawData = fs.readFileSync(jsonPath, "utf-8");
  console.log("Parsing JSON file...");
  const parsed = JSON.parse(rawData);
  const foods = parsed.SRLegacyFoods || [];
  console.log(`Successfully parsed ${foods.length} foods from SR Legacy.`);

  console.log("Preparing database insert payloads...");
  const payloads = foods.map((food: any) => {
    const macros = extractNutrients(food.foodNutrients || []);
    return {
      fdcId: food.fdcId,
      description: food.description,
      foodCategory: food.foodCategory?.description || "Other",
      caloriesKcal: macros.caloriesKcal,
      proteinG: macros.proteinG,
      fatG: macros.fatG,
      carbsG: macros.carbsG,
      fiberG: macros.fiberG,
      sodiumMg: macros.sodiumMg,
      sugarG: macros.sugarG,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });

  console.log("Inserting records into the 'usda_foods' table in batches...");
  const batchSize = 500;
  let insertedCount = 0;

  for (let i = 0; i < payloads.length; i += batchSize) {
    const batch = payloads.slice(i, i + batchSize);
    try {
      await db
        .insert(usdaFoods)
        .values(batch)
        .onConflictDoUpdate({
          target: [usdaFoods.fdcId],
          set: {
            description: sql`excluded.description`,
            foodCategory: sql`excluded.food_category`,
            caloriesKcal: sql`excluded.calories_kcal`,
            proteinG: sql`excluded.protein_g`,
            fatG: sql`excluded.fat_g`,
            carbsG: sql`excluded.carbs_g`,
            fiberG: sql`excluded.fiber_g`,
            sodiumMg: sql`excluded.sodium_mg`,
            sugarG: sql`excluded.sugar_g`,
            updatedAt: new Date(),
          } as any,
        });
      insertedCount += batch.length;
      console.log(
        `💪 Inserted/Updated batch: ${insertedCount}/${payloads.length}`,
      );
    } catch (err: any) {
      console.error(
        `❌ Error in batch starting at index ${i}:`,
        err.message || err,
      );
    }
  }

  console.log(
    `\n🎉 Seeding completed! Mapped and saved ${insertedCount} USDA foods.`,
  );
}

// Helper to avoid sql tag build failures if not imported
import { sql } from "drizzle-orm";

main().catch(console.error);
