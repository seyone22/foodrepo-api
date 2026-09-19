import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { eq, like, or } from "drizzle-orm";

const TARGET_WEIGHT_ENTRIES = [
  { raw: "gingerroot 45g", clean: "gingerroot" },
  { raw: "450g parrot fish red snapper", clean: "parrot fish red snapper" },
  { raw: "butternut squash 2lb", clean: "butternut squash" },
  { raw: "havarti cheese 2oz", clean: "havarti cheese" },
  { raw: "450g tomatillo", clean: "tomatillo" }
];

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

async function fixWeightQuantities() {
  console.log("🚀 Starting Hardcoded Weight/Quantity Cleanup...\n");

  const allIngs = await db.select().from(ingredients);
  const nameToIngMap = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs) {
    nameToIngMap.set(ing.name.toLowerCase().trim(), ing);
  }

  let mergedCount = 0;
  let renamedCount = 0;

  for (const target of TARGET_WEIGHT_ENTRIES) {
    const rawIng = nameToIngMap.get(target.raw.toLowerCase().trim());
    if (!rawIng) {
      console.log(`⚠️ Entry not found (may have already been cleaned): "${target.raw}"`);
      continue;
    }

    console.log(`📌 Processing: "${rawIng.name}" (ID: ${rawIng.id}) ➔ Target: "${target.clean}"`);

    const existingCanonical = nameToIngMap.get(target.clean.toLowerCase().trim());

    if (existingCanonical && existingCanonical.id !== rawIng.id) {
      // Canonical entry already exists! Merge rawIng into existingCanonical
      console.log(`   ⚡ DUPLICATE FOUND! Merging into existing "${existingCanonical.name}" (ID: ${existingCanonical.id})`);

      const combinedAliases = mergeArrays(existingCanonical.aliases, rawIng.aliases, [rawIng.name]);
      const combinedVarieties = mergeArrays(existingCanonical.varieties, rawIng.varieties);
      const combinedUsedIn = mergeArrays(existingCanonical.usedIn, rawIng.usedIn);

      await db.update(ingredients)
        .set({
          aliases: combinedAliases,
          varieties: combinedVarieties,
          usedIn: combinedUsedIn,
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, existingCanonical.id));

      // Re-link product mappings
      const relatedMappings = await db.select({
        id: mappings.id,
        matchedIngredients: mappings.matchedIngredients
      }).from(mappings);

      for (const m of relatedMappings) {
        if (m.matchedIngredients && m.matchedIngredients.includes(rawIng.id)) {
          const newMatched = mergeArrays(
            m.matchedIngredients.map(id => id === rawIng.id ? existingCanonical.id : id)
          );
          await db.update(mappings)
            .set({ matchedIngredients: newMatched })
            .where(eq(mappings.id, m.id));
        }
      }

      // Delete rawIng
      await db.delete(ingredients).where(eq(ingredients.id, rawIng.id));
      mergedCount++;
    } else {
      // No duplicate, rename in place
      console.log(`   ✅ Renaming in place to "${target.clean}"`);
      await db.update(ingredients)
        .set({
          name: target.clean,
          aliases: mergeArrays(rawIng.aliases, [rawIng.name]),
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, rawIng.id));

      nameToIngMap.set(target.clean.toLowerCase().trim(), { ...rawIng, name: target.clean });
      renamedCount++;
    }
  }

  console.log("\n==================================================");
  console.log("       WEIGHT / QUANTITY CLEANUP COMPLETE          ");
  console.log("==================================================");
  console.log(`Merged Into Canonical Records: ${mergedCount}`);
  console.log(`Renamed In-Place:               ${renamedCount}`);
  console.log("==================================================\n");
}

fixWeightQuantities()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error fixing weight quantities:", err);
    process.exit(1);
  });
