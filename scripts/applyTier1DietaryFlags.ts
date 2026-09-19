import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { ingredients } from "@/utils/schema";
import { classifyDietaryFlags } from "@/services/dietaryClassifier";
import { sql } from "drizzle-orm";

async function runTier1DietaryPass() {
  const startTime = Date.now();
  console.log("=========================================================================");
  console.log("🚀 HIGH-SPEED TIER 1 DETERMINISTIC DIETARY FLAGS CLASSIFIER (NO AI)");
  console.log("=========================================================================\n");

  console.log("📥 Loading all master ingredients from database...");
  const allIngredients = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      cuisine: ingredients.cuisine,
      flavorProfile: ingredients.flavorProfile,
    })
    .from(ingredients);

  const total = allIngredients.length;
  console.log(`📦 Loaded ${total} master ingredients.\n`);

  console.log("⚡ Processing deterministic rules across dataset...");
  
  let processed = 0;
  let veganCount = 0;
  let vegCount = 0;
  let pescatarianCount = 0;
  let gfCount = 0;
  let dfCount = 0;
  let halalCount = 0;
  let kosherCount = 0;

  const BATCH_SIZE = 1000;
  let batchUpdates: { id: string; flags: string[] }[] = [];

  for (const item of allIngredients) {
    const res = classifyDietaryFlags(
      item.name,
      item.cuisine || [],
      item.flavorProfile || []
    );

    if (res.dietaryFlags.includes("vegan")) veganCount++;
    if (res.dietaryFlags.includes("vegetarian")) vegCount++;
    if (res.dietaryFlags.includes("pescatarian")) pescatarianCount++;
    if (res.dietaryFlags.includes("gluten_free")) gfCount++;
    if (res.dietaryFlags.includes("dairy_free")) dfCount++;
    if (res.dietaryFlags.includes("halal")) halalCount++;
    if (res.dietaryFlags.includes("kosher")) kosherCount++;

    batchUpdates.push({ id: item.id, flags: res.dietaryFlags });
    processed++;

    if (batchUpdates.length >= BATCH_SIZE || processed === total) {
      // Bulk update using Postgres CASE WHEN statement
      const sqlCases = batchUpdates
        .map(
          (u) =>
            `WHEN id = '${u.id}'::uuid THEN ARRAY[${u.flags.map((f) => `'${f}'`).join(",")}]::text[]`
        )
        .join(" ");

      const idsList = batchUpdates.map((u) => `'${u.id}'::uuid`).join(",");

      const query = sql.raw(
        `UPDATE foodrepo.ingredients 
         SET dietary_flags = CASE ${sqlCases} END,
             last_modified = NOW()
         WHERE id IN (${idsList})`
      );

      await db.execute(query);
      console.log(`  └─ Updated ${processed}/${total} items (${((processed / total) * 100).toFixed(1)}%)...`);
      batchUpdates = [];
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n=========================================================================");
  console.log("🎉 TIER 1 DIETARY CLASSIFICATION COMPLETED SUCCESSFULLY!");
  console.log("=========================================================================");
  console.log(`⏱️ Execution Time: ${durationSec} seconds`);
  console.log(`✅ Total Ingredients Classified: ${processed} / ${total} (100.0%)`);
  console.log("\n📊 Breakdown of Tag Population Across Master Ingredients:");
  console.log(`  ├─ Vegan:               ${veganCount} (${((veganCount / total) * 100).toFixed(1)}%)`);
  console.log(`  ├─ Vegetarian:          ${vegCount} (${((vegCount / total) * 100).toFixed(1)}%)`);
  console.log(`  ├─ Pescatarian:         ${pescatarianCount} (${((pescatarianCount / total) * 100).toFixed(1)}%)`);
  console.log(`  ├─ Gluten-Free:         ${gfCount} (${((gfCount / total) * 100).toFixed(1)}%)`);
  console.log(`  ├─ Dairy-Free:          ${dfCount} (${((dfCount / total) * 100).toFixed(1)}%)`);
  console.log(`  ├─ Halal:               ${halalCount} (${((halalCount / total) * 100).toFixed(1)}%)`);
  console.log(`  └─ Kosher:              ${kosherCount} (${((kosherCount / total) * 100).toFixed(1)}%)\n`);
}

runTier1DietaryPass()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Execution Error:", err);
    process.exit(1);
  });
