import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { eq, inArray } from "drizzle-orm";

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

function normalizeName(name: string): string {
  let clean = name.trim();

  // Inverted format: "word, descriptor" -> "descriptor word"
  if (clean.includes(",")) {
    const parts = clean.split(",").map(p => p.trim());
    if (parts.length === 2) {
      clean = `${parts[1]} ${parts[0]}`;
    }
  }

  // Parenthetical format: "word (descriptor)" -> "descriptor word"
  if (/\(.*\)/.test(clean)) {
    const match = clean.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      clean = `${match[2]} ${match[1]}`;
    }
  }

  return clean.toLowerCase().trim();
}

async function fixRemainingAnomalies() {
  console.log("🚀 Starting Comprehensive Database Anomaly Remediation (v3)...\n");

  let mergedCount = 0;
  let renamedCount = 0;
  let cleanedAliasesCount = 0;

  // 1. Fix Typos & Inverted Comma / Parenthetical Names
  console.log("🔹 Step 1: Fixing Inverted & Parenthetical Names...");
  const allIngs1 = await db.select().from(ingredients);
  const map1 = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs1) {
    map1.set(ing.name.toLowerCase().trim(), ing);
  }

  for (const ing of allIngs1) {
    let targetName = ing.name;

    if (ing.name.toLowerCase().includes("artifical") || ing.name.toLowerCase().includes("sweetners")) {
      targetName = "artificial sweetener";
    } else {
      targetName = normalizeName(ing.name);
    }

    if (targetName === ing.name.toLowerCase().trim()) continue;

    console.log(`   📌 Transform: "${ing.name}" ➔ "${targetName}"`);
    const existingCanonical = map1.get(targetName);

    if (existingCanonical && existingCanonical.id !== ing.id) {
      console.log(`      ⚡ DUPLICATE FOUND! Merging into existing "${existingCanonical.name}" (ID: ${existingCanonical.id})`);

      const combinedAliases = mergeArrays(existingCanonical.aliases, ing.aliases, [ing.name]);
      const combinedVarieties = mergeArrays(existingCanonical.varieties, ing.varieties);
      const combinedUsedIn = mergeArrays(existingCanonical.usedIn, ing.usedIn);

      await db.update(ingredients)
        .set({
          aliases: combinedAliases,
          varieties: combinedVarieties,
          usedIn: combinedUsedIn,
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, existingCanonical.id));

      const relatedMappings = await db.select({
        id: mappings.id,
        matchedIngredients: mappings.matchedIngredients
      }).from(mappings);

      for (const m of relatedMappings) {
        if (m.matchedIngredients && m.matchedIngredients.includes(ing.id)) {
          const newMatched = mergeArrays(
            m.matchedIngredients.map(id => id === ing.id ? existingCanonical.id : id)
          );
          await db.update(mappings)
            .set({ matchedIngredients: newMatched })
            .where(eq(mappings.id, m.id));
        }
      }

      await db.delete(ingredients).where(eq(ingredients.id, ing.id));
      mergedCount++;
    } else {
      console.log(`      ✅ Renaming in place to "${targetName}"`);
      await db.update(ingredients)
        .set({
          name: targetName,
          aliases: mergeArrays(ing.aliases, [ing.name]),
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, ing.id));

      map1.set(targetName, { ...ing, name: targetName });
      renamedCount++;
    }
  }

  // 2. Resolve Hyphen vs Space Duplicate Pairs
  console.log("\n🔹 Step 2: Resolving Hyphen vs Space Duplicate Pairs...");
  const allIngs2 = await db.select().from(ingredients);
  const map2 = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs2) {
    map2.set(ing.name.toLowerCase().trim(), ing);
  }

  for (const ing of allIngs2) {
    if (ing.name.includes("-")) {
      const dehyphenated = ing.name.replace(/-/g, " ").toLowerCase().trim();
      const existingSpaceIng = map2.get(dehyphenated);

      if (existingSpaceIng && existingSpaceIng.id !== ing.id) {
        console.log(`   ⚡ HYPHEN DUPLICATE: Merging "${ing.name}" ➔ "${existingSpaceIng.name}"`);

        const combinedAliases = mergeArrays(existingSpaceIng.aliases, ing.aliases, [ing.name]);

        await db.update(ingredients)
          .set({
            aliases: combinedAliases,
            lastModified: new Date(),
            updatedAt: new Date()
          })
          .where(eq(ingredients.id, existingSpaceIng.id));

        const relatedMappings = await db.select({
          id: mappings.id,
          matchedIngredients: mappings.matchedIngredients
        }).from(mappings);

        for (const m of relatedMappings) {
          if (m.matchedIngredients && m.matchedIngredients.includes(ing.id)) {
            const newMatched = mergeArrays(
              m.matchedIngredients.map(id => id === ing.id ? existingSpaceIng.id : id)
            );
            await db.update(mappings)
              .set({ matchedIngredients: newMatched })
              .where(eq(mappings.id, m.id));
          }
        }

        await db.delete(ingredients).where(eq(ingredients.id, ing.id));
        mergedCount++;
      }
    }
  }

  // 3. Lowercase Casing Normalization (Grouping by lowercased name first)
  console.log("\n🔹 Step 3: Normalizing Casing to Lowercase & Merging Case Collisions...");
  const allIngs3 = await db.select().from(ingredients);
  const caseGroups = new Map<string, Array<typeof ingredients.$inferSelect>>();

  for (const ing of allIngs3) {
    const key = ing.name.toLowerCase().trim();
    if (!caseGroups.has(key)) {
      caseGroups.set(key, []);
    }
    caseGroups.get(key)!.push(ing);
  }

  for (const [lowerKey, group] of caseGroups.entries()) {
    if (group.length > 1) {
      // Pick the item that is already lowercased, or default to first
      let canonical = group.find(g => g.name === lowerKey) || group[0];
      const duplicates = group.filter(g => g.id !== canonical.id);

      console.log(`   ⚡ CASE MERGE: Keeping "${canonical.name}" (ID: ${canonical.id}) and merging ${duplicates.length} duplicates...`);

      let combinedAliases = canonical.aliases;
      for (const d of duplicates) {
        combinedAliases = mergeArrays(combinedAliases, d.aliases, [d.name]);
      }

      await db.update(ingredients)
        .set({
          name: lowerKey,
          aliases: combinedAliases,
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, canonical.id));

      const dupeIds = duplicates.map(d => d.id);
      const relatedMappings = await db.select({
        id: mappings.id,
        matchedIngredients: mappings.matchedIngredients
      }).from(mappings);

      for (const m of relatedMappings) {
        if (m.matchedIngredients && m.matchedIngredients.some(id => dupeIds.includes(id))) {
          const newMatched = mergeArrays(
            m.matchedIngredients.map(id => dupeIds.includes(id) ? canonical.id : id)
          );
          await db.update(mappings)
            .set({ matchedIngredients: newMatched })
            .where(eq(mappings.id, m.id));
        }
      }

      await db.delete(ingredients).where(inArray(ingredients.id, dupeIds));
      mergedCount += duplicates.length;
    } else {
      const ing = group[0];
      if (ing.name !== lowerKey) {
        await db.update(ingredients)
          .set({ name: lowerKey, lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, ing.id));
      }
    }
  }

  // 4. Clean Self-Referential Aliases
  console.log("\n🔹 Step 4: Cleaning Self-Referential Aliases...");
  const finalIngs = await db.select().from(ingredients);
  for (const ing of finalIngs) {
    if (ing.aliases && ing.aliases.length > 0) {
      const lowerName = ing.name.toLowerCase().trim();
      const filtered = Array.from(new Set(ing.aliases.map(a => a.trim()))).filter(a => a.toLowerCase().trim() !== lowerName);
      if (filtered.length !== ing.aliases.length) {
        await db.update(ingredients)
          .set({ aliases: filtered, lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, ing.id));
        cleanedAliasesCount++;
      }
    }
  }

  console.log("\n==================================================");
  console.log("       REMEDIATION EXECUTION COMPLETE (v3)        ");
  console.log("==================================================");
  console.log(`Merged Duplicate Records:      ${mergedCount}`);
  console.log(`Renamed / Inverted In-Place:   ${renamedCount}`);
  console.log(`Cleaned Self-Aliases:          ${cleanedAliasesCount}`);
  console.log("==================================================\n");
}

fixRemainingAnomalies()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error during remediation:", err);
    process.exit(1);
  });
