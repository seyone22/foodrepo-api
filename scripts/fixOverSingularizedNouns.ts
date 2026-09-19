import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { eq } from "drizzle-orm";

const RECTIFICATIONS: Record<string, string> = {
  "dark molass": "dark molasses",
  "sorghum molass": "sorghum molasses",
  "calvado": "calvados",
  "chaume": "chaumes",
  "epoiss": "epoisses",
  "butterscotch schnapp": "butterscotch schnapps",
  "black cherry schnapp": "black cherry schnapps",
  "anaheim chily": "anaheim chili",
  "ancho chily": "ancho chili",
  "asian red chily": "asian red chili",
  "green serrano chily": "green serrano chili",
  "hatch green chily": "hatch green chili",
  "jalapeno pepper green chily": "jalapeno pepper green chili",
  "new mexico chile guajillo chily": "new mexico chile guajillo chili",
  "red kashmiri chily": "red kashmiri chili",
  "rotel tomato chily": "rotel tomato chili",
  "vietnamese garlic red chile paste chily": "vietnamese garlic red chili paste"
};

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

async function fixOverSingularizedNouns() {
  const allIngs = await db.select().from(ingredients);
  const nameMap = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs) {
    nameMap.set(ing.name.toLowerCase().trim(), ing);
  }

  for (const ing of allIngs) {
    if (RECTIFICATIONS[ing.name]) {
      const correctName = RECTIFICATIONS[ing.name];
      const existing = nameMap.get(correctName);

      if (existing && existing.id !== ing.id) {
        console.log(`⚡ DUPLICATE MERGE: "${ing.name}" ➔ existing "${existing.name}"`);
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
      } else {
        console.log(`🔧 Rectifying: "${ing.name}" ➔ "${correctName}"`);
        await db.update(ingredients)
          .set({ name: correctName, lastModified: new Date(), updatedAt: new Date() })
          .where(eq(ingredients.id, ing.id));
        nameMap.set(correctName, { ...ing, name: correctName });
      }
    }
  }

  console.log("✅ Over-singularization rectification complete!");
}

fixOverSingularizedNouns()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error rectifying nouns:", err);
    process.exit(1);
  });
