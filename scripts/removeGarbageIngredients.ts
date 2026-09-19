import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { inArray } from "drizzle-orm";

const GARBAGE_IDS = [
  "f6109b52-4024-9d4b-4bab-dbc2a2d48f36", // ""
  "c947e6cf-2770-f506-fc62-b455e30ae460", // "'"
  "69cda608-471c-fed0-bf04-bb4c2408cfdc", // "1lb"
  "095868b2-79ef-1465-10d2-16c710734cde", // "u"
  "c5fa00dc-9632-60d7-376c-cadce044f570", // "be"
  "7b1959f9-c5c0-3eb7-d0a4-9961101178d8", // "up"
  "1f450a0e-afc5-7833-8c60-fd8b5c4c93b4", // "el"
  "71eff4e0-6912-4dac-a619-630acaef7643", // "rr"
];

async function removeGarbageIngredients() {
  console.log("🗑️ Removing garbage ingredient entries from database...\n");

  const targetIngs = await db.select({
    id: ingredients.id,
    name: ingredients.name
  }).from(ingredients).where(inArray(ingredients.id, GARBAGE_IDS));

  console.log("Found target ingredients to delete:");
  console.table(targetIngs);

  if (targetIngs.length === 0) {
    console.log("⚠️ No matching garbage ingredients found (they may have already been deleted).");
    process.exit(0);
  }

  // Check and clean any product mappings referencing these garbage IDs
  const allMappings = await db.select({
    id: mappings.id,
    matchedIngredients: mappings.matchedIngredients
  }).from(mappings);

  let cleanedMappings = 0;
  const garbageSet = new Set(GARBAGE_IDS);

  for (const m of allMappings) {
    if (!m.matchedIngredients) continue;
    if (m.matchedIngredients.some(id => garbageSet.has(id))) {
      const filtered = m.matchedIngredients.filter(id => !garbageSet.has(id));
      await db.update(mappings)
        .set({ matchedIngredients: filtered })
        .where(eq(mappings.id, m.id));
      cleanedMappings++;
    }
  }

  // Delete garbage entries from ingredients table
  const deleted = await db.delete(ingredients).where(inArray(ingredients.id, GARBAGE_IDS));

  console.log(`\n✅ Successfully deleted ${targetIngs.length} garbage entries from foodrepo.ingredients.`);
  console.log(`✅ Cleaned ${cleanedMappings} product mapping references.`);
}

import { eq } from "drizzle-orm";

removeGarbageIngredients()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error removing garbage ingredients:", err);
    process.exit(1);
  });
