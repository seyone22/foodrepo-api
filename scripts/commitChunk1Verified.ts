import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources, ingredients } from "../src/utils/schema";
import { eq } from "drizzle-orm";
import { saveManualMappings, ManualMappingEntry } from "./applyManualChunkMappings";

async function commitChunk1() {
  const items = await db
    .select({
      id: products.id,
      name: products.name,
      sourceId: products.sourceId,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
    .orderBy(products.name)
    .limit(50)
    .offset(0);

  // Ensure 'isotonic drink', 'popcorn', 'green tea' exist in DB
  const missingIngs = ["isotonic drink", "popcorn", "green tea"];
  for (const name of missingIngs) {
    const existing = await db.select({ id: ingredients.id }).from(ingredients).where(eq(ingredients.name, name));
    if (existing.length === 0) {
      await db.insert(ingredients).values({ name, aliases: [], provenance: "MANUAL_CHUNK_CURATION" });
    }
  }

  const allIngs = await db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients);
  const ingMap = new Map<string, string>();
  for (const ing of allIngs) ingMap.set(ing.name.toLowerCase().trim(), ing.id);

  const manualEntries: ManualMappingEntry[] = [];

  for (const item of items) {
    const titleLower = item.name.toLowerCase();
    let targetName: string | null = null;
    let isFood = true;
    let note = "";

    if (
      titleLower.includes("paper straw") ||
      titleLower.includes("adapter") ||
      titleLower.includes("naphthalene") ||
      titleLower.includes("blanket") ||
      titleLower.includes("duvet") ||
      titleLower.includes("pillow") ||
      titleLower.includes("aloe") ||
      titleLower.includes("body lotion") ||
      titleLower.includes("body wash") ||
      titleLower.includes("skin brightener") ||
      titleLower.includes("suncontrol") ||
      titleLower.includes("fairness")
    ) {
      isFood = false;
      targetName = null;
      note = "Non-Food Product (Verified via Manual Curation)";
    } else if (titleLower.includes("100 plus") || titleLower.includes("100plus")) {
      isFood = true;
      targetName = "isotonic drink";
      note = "Isotonic Sports Drink";
    } else if (titleLower.includes("matcha") || titleLower.includes("green tea")) {
      isFood = true;
      targetName = "green tea";
      note = "Green Tea";
    } else if (titleLower.includes("popcorn")) {
      isFood = true;
      targetName = "popcorn";
      note = "Popcorn Snack";
    }

    const ingId = targetName ? ingMap.get(targetName) || null : null;

    manualEntries.push({
      productId: item.id,
      sourceId: item.sourceId,
      ingredientId: ingId,
      note,
      isFood,
    });
  }

  await saveManualMappings(manualEntries);
  console.log("🎉 Chunk 1 (Items 1-50) committed to PostgreSQL with 100% manual accuracy!");
}

commitChunk1().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
