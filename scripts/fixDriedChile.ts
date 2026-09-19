import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { eq } from "drizzle-orm";

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

async function fixDriedChile() {
  const allIngs = await db.select().from(ingredients);
  const chileIng = allIngs.find(i => i.name.toLowerCase() === "dried chile");
  const chiliIng = allIngs.find(i => i.name.toLowerCase() === "dried chili");

  if (chileIng && chiliIng) {
    console.log(`⚡ Merging "dried chile" into existing "dried chili"...`);
    const combinedAliases = mergeArrays(chiliIng.aliases, chileIng.aliases, ["dried chile"]);
    await db.update(ingredients)
      .set({ aliases: combinedAliases, lastModified: new Date(), updatedAt: new Date() })
      .where(eq(ingredients.id, chiliIng.id));

    const relatedMappings = await db.select({
      id: mappings.id,
      matchedIngredients: mappings.matchedIngredients
    }).from(mappings);

    for (const m of relatedMappings) {
      if (m.matchedIngredients && m.matchedIngredients.includes(chileIng.id)) {
        const newMatched = mergeArrays(
          m.matchedIngredients.map(id => id === chileIng.id ? chiliIng.id : id)
        );
        await db.update(mappings)
          .set({ matchedIngredients: newMatched })
          .where(eq(mappings.id, m.id));
      }
    }

    await db.delete(ingredients).where(eq(ingredients.id, chileIng.id));
  } else if (chileIng) {
    console.log(`🔄 Renaming "dried chile" ➔ "dried chili"...`);
    await db.update(ingredients)
      .set({ name: "dried chili", aliases: mergeArrays(chileIng.aliases, ["dried chile"]) })
      .where(eq(ingredients.id, chileIng.id));
  }

  console.log("✅ Fix complete!");
}

fixDriedChile().then(() => process.exit(0));
