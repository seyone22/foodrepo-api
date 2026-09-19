import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { eq, inArray, like, or } from "drizzle-orm";

// Rules for cleaning raw scraped strings to canonical ingredient names
function cleanScrapedName(rawName: string): { cleanedName: string | null; action: "fix" | "trash" } {
  let name = rawName.trim();

  // Remove HTML entity fragments like "quot ;", "&quot;", "&amp;", etc.
  name = name.replace(/quot\s*;/gi, "");
  name = name.replace(/&quot;/gi, "");
  name = name.replace(/&amp;/gi, "and");
  name = name.replace(/&#\d+;/g, "");

  // Remove scraper recipe codes like "fisher reg ;", "kraft reg ;", "reg ;"
  name = name.replace(/\b(fisher|kraft|chef boyardee|crisco)\s+reg\s*;/gi, "");
  name = name.replace(/\breg\s*;/gi, "");

  // Fix delimiter artifacts like "breadcrumb ? bread"
  if (name.includes("?")) {
    const parts = name.split("?").map(p => p.trim());
    name = parts[0]; // take the main head word (e.g. "breadcrumb")
  }

  // Remove trailing/leading punctuation, semicolons, extra spaces
  name = name.replace(/^[;\s,-]+|[;\s,-]+$/g, "").replace(/\s{2,}/g, " ").trim().toLowerCase();

  // Trash check: if cleaned name is too short or invalid
  if (!name || name.length < 2 || /^\d+$/.test(name)) {
    return { cleanedName: null, action: "trash" };
  }

  return { cleanedName: name, action: "fix" };
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

async function runCleaner() {
  console.log("🚀 Starting Scraper Artifact & Special Character Cleaning...\n");

  const allIngs = await db.select().from(ingredients);

  // Find target anomalous ingredients containing ;, ?, quot, reg, %, etc.
  const anomalous = allIngs.filter(ing => {
    const n = ing.name.toLowerCase();
    return n.includes(";") || n.includes("?") || n.includes("quot") || n.includes("reg ;") || n.includes("%");
  });

  console.log(`🔍 Found ${anomalous.length} ingredients matching scraper/special character patterns.\n`);

  const nameToIngMap = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs) {
    nameToIngMap.set(ing.name.toLowerCase().trim(), ing);
  }

  let trashCount = 0;
  let fixedRenameCount = 0;
  let mergedDupeCount = 0;
  let reLinkedMappingsCount = 0;

  for (const ing of anomalous) {
    const { cleanedName, action } = cleanScrapedName(ing.name);

    if (action === "trash" || !cleanedName) {
      console.log(`🗑️ TRASHING: "${ing.name}" (ID: ${ing.id})`);
      // Delete from ingredients
      await db.delete(ingredients).where(eq(ingredients.id, ing.id));
      trashCount++;
      continue;
    }

    if (cleanedName === ing.name.toLowerCase().trim()) {
      // No change needed
      continue;
    }

    console.log(`🔧 FIXING: "${ing.name}" ➔ "${cleanedName}"`);

    const existingIng = nameToIngMap.get(cleanedName);

    if (existingIng && existingIng.id !== ing.id) {
      // Dupe found! Merge ing into existingIng
      console.log(`   └─ ⚡ DUPLICATE FOUND! Merging into existing "${existingIng.name}" (ID: ${existingIng.id})`);

      const combinedAliases = mergeArrays(existingIng.aliases, ing.aliases, [ing.name]);
      const combinedVarieties = mergeArrays(existingIng.varieties, ing.varieties);
      const combinedUsedIn = mergeArrays(existingIng.usedIn, ing.usedIn);
      const combinedSubstitutes = mergeArrays(existingIng.substitutes, ing.substitutes);

      await db.update(ingredients)
        .set({
          aliases: combinedAliases,
          varieties: combinedVarieties,
          usedIn: combinedUsedIn,
          substitutes: combinedSubstitutes,
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, existingIng.id));

      // Re-link mappings
      const relatedMappings = await db.select({
        id: mappings.id,
        matchedIngredients: mappings.matchedIngredients
      }).from(mappings);

      for (const m of relatedMappings) {
        if (m.matchedIngredients && m.matchedIngredients.includes(ing.id)) {
          const newMatched = mergeArrays(
            m.matchedIngredients.map(id => id === ing.id ? existingIng.id : id)
          );
          await db.update(mappings)
            .set({ matchedIngredients: newMatched })
            .where(eq(mappings.id, m.id));
          reLinkedMappingsCount++;
        }
      }

      // Delete old ing record
      await db.delete(ingredients).where(eq(ingredients.id, ing.id));
      mergedDupeCount++;
    } else {
      // No dupe, update name in place
      console.log(`   └─ ✅ Renaming in place`);
      await db.update(ingredients)
        .set({
          name: cleanedName,
          aliases: mergeArrays(ing.aliases, [ing.name]),
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, ing.id));

      nameToIngMap.set(cleanedName, { ...ing, name: cleanedName });
      fixedRenameCount++;
    }
  }

  console.log("\n==================================================");
  console.log("          SCRAPER CLEANING EXECUTION SUMMARY       ");
  console.log("==================================================");
  console.log(`Anomalous Entries Evaluated: ${anomalous.length}`);
  console.log(`Renamed & Fixed In-Place:   ${fixedRenameCount}`);
  console.log(`Merged Duplicate Records:    ${mergedDupeCount}`);
  console.log(`Trashed Garbage Records:     ${trashCount}`);
  console.log(`Product Mappings Re-linked:  ${reLinkedMappingsCount}`);
  console.log("==================================================\n");
}

runCleaner()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error running cleaner:", err);
    process.exit(1);
  });
