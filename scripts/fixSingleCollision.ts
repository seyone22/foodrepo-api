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

async function fixSingleCollision() {
  const allIngs = await db.select().from(ingredients);
  const singIng = allIngs.find(i => i.name.toLowerCase() === "artificial sweetener");
  const plurIng = allIngs.find(i => i.name.toLowerCase() === "artificial sweeteners");

  if (singIng && plurIng) {
    console.log(`⚡ Merging "${plurIng.name}" (ID: ${plurIng.id}) into "${singIng.name}" (ID: ${singIng.id})...`);
    const combinedAliases = mergeArrays(singIng.aliases, plurIng.aliases, [plurIng.name]);

    await db.update(ingredients)
      .set({ aliases: combinedAliases, lastModified: new Date(), updatedAt: new Date() })
      .where(eq(ingredients.id, singIng.id));

    const relatedMappings = await db.select({
      id: mappings.id,
      matchedIngredients: mappings.matchedIngredients
    }).from(mappings);

    for (const m of relatedMappings) {
      if (m.matchedIngredients && m.matchedIngredients.includes(plurIng.id)) {
        const newMatched = mergeArrays(
          m.matchedIngredients.map(id => id === plurIng.id ? singIng.id : id)
        );
        await db.update(mappings)
          .set({ matchedIngredients: newMatched })
          .where(eq(mappings.id, m.id));
      }
    }

    await db.delete(ingredients).where(eq(ingredients.id, plurIng.id));
    console.log("✅ Successfully merged!");
  }
}

fixSingleCollision()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
