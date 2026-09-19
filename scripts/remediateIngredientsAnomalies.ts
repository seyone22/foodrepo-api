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

async function remediateIngredientsAnomalies() {
  console.log("🚀 Starting Comprehensive Ingredient Anomaly Remediation...\n");

  let mergedCount = 0;
  let renamedCount = 0;
  let deletedGarbageCount = 0;
  let cleanedAliasesCount = 0;

  // 1. Purge Scraped Abbreviation Garbage ("reg", "red")
  console.log("🔹 Step 1: Purging Garbage Single-Term Entries ('reg', 'red')...");
  const garbageNames = ["reg", "red"];
  const garbageIngs = await db.select().from(ingredients).where(inArray(ingredients.name, garbageNames));

  for (const g of garbageIngs) {
    console.log(`   ❌ Deleting garbage entry: "${g.name}" (ID: ${g.id})`);
    await db.delete(ingredients).where(eq(ingredients.id, g.id));
    deletedGarbageCount++;
  }

  // 2. Strip Brand Symbols & Trademarks (™, ®)
  console.log("\n🔹 Step 2: Stripping Trademark & Brand Symbols (™, ®)...");
  const allIngs2 = await db.select().from(ingredients);
  for (const ing of allIngs2) {
    if (/[™®]/.test(ing.name)) {
      const cleanName = ing.name.replace(/[™®]/g, "").replace(/\s{2,}/g, " ").trim();
      console.log(`   ✂️  Stripping trademark: "${ing.name}" ➔ "${cleanName}"`);

      // Check if cleanName collision exists
      const existing = allIngs2.find(i => i.name === cleanName && i.id !== ing.id);
      if (existing) {
        console.log(`      ⚡ MERGING into existing "${existing.name}" (ID: ${existing.id})`);
        const combinedAliases = mergeArrays(existing.aliases, ing.aliases, [ing.name]);
        await db.update(ingredients)
          .set({ aliases: combinedAliases, lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, existing.id));

        await db.delete(ingredients).where(eq(ingredients.id, ing.id));
        mergedCount++;
      } else {
        await db.update(ingredients)
          .set({ name: cleanName, aliases: mergeArrays(ing.aliases, [ing.name]), lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, ing.id));
        renamedCount++;
      }
    }
  }

  // 3. Fix Scraped Recipe Notes & Long Strings
  console.log("\n🔹 Step 3: Fixing Scraped Recipe Notes & Multi-Ingredient Strings...");
  const SPECIFIC_RECIPE_NOTE_REPLACEMENTS: Record<string, string> = {
    "chicken stock ordinary bullion cube are salty": "chicken stock",
    "serving suggestion red onion cilantro leaf lime juice": "red onion",
    "kittencal no fail buttery flaky pie pastry crust": "pie crust",
    "pepperoni choice canadian bacon sausage black olive": "pepperoni",
    "salad dressing cream salt celery mustard powde": "salad dressing",
    "kabsa spice mix cardamom seed black pepper cumin": "kabsa spice mix",
    "pick selection vegetable zucchini black olive": "zucchini",
    "garden salad lettuce tomato onion bell pepper olive": "garden salad",
    "hershey special dark chocolate chip macadamia nut": "dark chocolate chip",
    "betty crocker chicken helper fettuccine alfredo": "chicken helper fettuccine alfredo",
    "vegetable green bean onion red pepper mixture": "vegetable mixture",
    "morningstar farm meal starter grillers crumble": "grillers crumble",
    "honeysuckle white italian turkey sausage link": "italian turkey sausage",
    "italian vinaigrette oil vinegar salad dressing": "italian vinaigrette",
    "balsamic vinaigrette olive oil vinegar dressing": "balsamic vinaigrette"
  };

  const allIngs3 = await db.select().from(ingredients);
  const nameMap3 = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs3) {
    nameMap3.set(ing.name.toLowerCase().trim(), ing);
  }

  for (const ing of allIngs3) {
    if (SPECIFIC_RECIPE_NOTE_REPLACEMENTS[ing.name]) {
      const targetName = SPECIFIC_RECIPE_NOTE_REPLACEMENTS[ing.name];
      console.log(`   📌 Remediating recipe string: "${ing.name}" ➔ "${targetName}"`);

      const existing = nameMap3.get(targetName);
      if (existing && existing.id !== ing.id) {
        console.log(`      ⚡ MERGING into existing "${existing.name}" (ID: ${existing.id})`);
        const combinedAliases = mergeArrays(existing.aliases, ing.aliases, [ing.name]);
        await db.update(ingredients)
          .set({ aliases: combinedAliases, lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, existing.id));

        const relatedMappings = await db.select({
          id: mappings.id,
          matchedIngredients: mappings.matchedIngredients
        }).from(mappings);

        for (const m of relatedMappings) {
          if (m.matchedIngredients && m.matchedIngredients.includes(ing.id)) {
            const newMatched = mergeArrays(
              m.matchedIngredients.map(id => id === ing.id ? existing.id : id)
            );
            await db.update(mappings)
              .set({ matchedIngredients: newMatched })
              .where(eq(mappings.id, m.id));
          }
        }

        await db.delete(ingredients).where(eq(ingredients.id, ing.id));
        mergedCount++;
      } else {
        await db.update(ingredients)
          .set({ name: targetName, aliases: mergeArrays(ing.aliases, [ing.name]), lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, ing.id));
        nameMap3.set(targetName, { ...ing, name: targetName });
        renamedCount++;
      }
    }
  }

  // 4. Prep / Packaging Prefixes Cleanup ("fresh", "raw", "sliced", "diced", "mini", "large", "small")
  console.log("\n🔹 Step 4: Normalizing Prep / Packaging Prefix Words...");
  const prepPrefixes = ["fresh", "raw", "sliced", "diced", "chopped", "minced", "mini", "large", "small"];
  const allIngs4 = await db.select().from(ingredients);
  const nameMap4 = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs4) {
    nameMap4.set(ing.name.toLowerCase().trim(), ing);
  }

  for (const ing of allIngs4) {
    const tokens = ing.name.toLowerCase().split(/\s+/);
    if (tokens.length > 1 && prepPrefixes.includes(tokens[0])) {
      const baseName = tokens.slice(1).join(" ");
      const existingBase = nameMap4.get(baseName);

      if (existingBase && existingBase.id !== ing.id) {
        console.log(`   ⚡ PREP MERGE: "${ing.name}" ➔ existing "${existingBase.name}"`);
        const combinedAliases = mergeArrays(existingBase.aliases, ing.aliases, [ing.name]);

        await db.update(ingredients)
          .set({ aliases: combinedAliases, lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, existingBase.id));

        const relatedMappings = await db.select({
          id: mappings.id,
          matchedIngredients: mappings.matchedIngredients
        }).from(mappings);

        for (const m of relatedMappings) {
          if (m.matchedIngredients && m.matchedIngredients.includes(ing.id)) {
            const newMatched = mergeArrays(
              m.matchedIngredients.map(id => id === ing.id ? existingBase.id : id)
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

  // 5. Cross-Ingredient Alias Collisions Cleanup
  console.log("\n🔹 Step 5: Cleaning Cross-Ingredient Alias Collisions...");
  const allIngs5 = await db.select().from(ingredients);
  const primaryNameSet = new Set<string>(allIngs5.map(i => i.name.toLowerCase().trim()));

  for (const ing of allIngs5) {
    if (ing.aliases && ing.aliases.length > 0) {
      const lowerIngName = ing.name.toLowerCase().trim();
      const cleanedAliases = ing.aliases.filter(alias => {
        const lowerAlias = alias.toLowerCase().trim();
        // Keep alias IF it's not a collision with a DIFFERENT ingredient's primary name
        if (primaryNameSet.has(lowerAlias) && lowerAlias !== lowerIngName) {
          return false;
        }
        return true;
      });

      if (cleanedAliases.length !== ing.aliases.length) {
        await db.update(ingredients)
          .set({ aliases: cleanedAliases, lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, ing.id));
        cleanedAliasesCount++;
      }
    }
  }

  console.log("\n==================================================");
  console.log("       REMEDIATION EXECUTION COMPLETE             ");
  console.log("==================================================");
  console.log(`Merged Duplicate Records:      ${mergedCount}`);
  console.log(`Renamed / Cleaned In-Place:    ${renamedCount}`);
  console.log(`Purged Garbage Entries:        ${deletedGarbageCount}`);
  console.log(`Cleaned Alias Collisions:      ${cleanedAliasesCount}`);
  console.log("==================================================\n");
}

remediateIngredientsAnomalies()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error during remediation:", err);
    process.exit(1);
  });
