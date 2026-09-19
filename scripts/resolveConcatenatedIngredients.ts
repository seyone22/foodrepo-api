import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { eq, inArray } from "drizzle-orm";

const CONCATENATED_ROWS = [
  {
    id: "78d969b3-88c4-6ff5-7eb1-4437a8211fa3",
    raw: "cajun seasoning tb onion powder cayenne pepper leaf mexican oregano thyme",
    canonical: ["cajun seasoning", "onion powder", "cayenne pepper", "mexican oregano", "thyme"]
  },
  {
    id: "4b7ae0ad-d752-eb5b-a992-e19d6d28df18",
    raw: "taco seasoning mix paprika powder chilli enchilada seasoning tsp powd",
    canonical: ["taco seasoning", "paprika", "chilli", "enchilada seasoning"]
  },
  {
    id: "936a5a53-1f0e-95a0-80e9-79cad387da22",
    raw: "mccormack taco seasoning beef mccormick grill mate southwest seasoning",
    canonical: ["taco seasoning", "beef", "southwest seasoning"]
  },
  {
    id: "c939fd96-bb01-f73b-09af-600ac4c3c1ae",
    raw: "cajun seasoning seasoning mix blackening seasoning seasoning",
    canonical: ["cajun seasoning", "blackening seasoning"]
  }
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

async function resolveConcatenatedIngredients() {
  console.log("🚀 Resolving Concatenated Recipe Ingredient Rows...\n");

  const allIngs = await db.select().from(ingredients);
  const nameToIngMap = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs) {
    nameToIngMap.set(ing.name.toLowerCase().trim(), ing);
  }

  const idsToDelete: string[] = [];
  let insertedCount = 0;
  let reLinkedMappingsCount = 0;

  for (const row of CONCATENATED_ROWS) {
    console.log(`📌 Processing: "${row.raw}" (ID: ${row.id})`);
    idsToDelete.push(row.id);

    const canonicalIds: string[] = [];

    for (const itemName of row.canonical) {
      const cleanItem = itemName.toLowerCase().trim();
      let ing = nameToIngMap.get(cleanItem);

      if (!ing) {
        console.log(`   ➕ Inserting missing canonical ingredient: "${cleanItem}"`);
        const [newIng] = await db.insert(ingredients).values({
          name: cleanItem,
          provenance: "SYSTEM_RESOLVED",
          aliases: [],
          createdAt: new Date(),
          updatedAt: new Date()
        }).returning();

        ing = newIng;
        nameToIngMap.set(cleanItem, ing);
        insertedCount++;
      } else {
        console.log(`   ✅ Existing canonical ingredient found: "${ing.name}" (ID: ${ing.id})`);
      }

      canonicalIds.push(ing.id);
    }

    // Re-link any product mappings referencing the concatenated row ID to all its canonical IDs
    const relatedMappings = await db.select({
      id: mappings.id,
      matchedIngredients: mappings.matchedIngredients
    }).from(mappings);

    for (const m of relatedMappings) {
      if (m.matchedIngredients && m.matchedIngredients.includes(row.id)) {
        const updatedList = m.matchedIngredients.filter(id => id !== row.id);
        const combined = mergeArrays(updatedList, canonicalIds);
        await db.update(mappings)
          .set({ matchedIngredients: combined })
          .where(eq(mappings.id, m.id));
        reLinkedMappingsCount++;
      }
    }
  }

  // Delete the concatenated rows from ingredients table
  console.log(`\n🗑️ Deleting ${idsToDelete.length} concatenated recipe rows...`);
  await db.delete(ingredients).where(inArray(ingredients.id, idsToDelete));

  console.log("\n==================================================");
  console.log("      CONCATENATED INGREDIENTS RESOLUTION COMPLETE ");
  console.log("==================================================");
  console.log(`Concatenated Rows Deleted:  ${idsToDelete.length}`);
  console.log(`New Canonical Items Added: ${insertedCount}`);
  console.log(`Product Mappings Re-linked: ${reLinkedMappingsCount}`);
  console.log("==================================================\n");
}

resolveConcatenatedIngredients()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error resolving concatenated ingredients:", err);
    process.exit(1);
  });
