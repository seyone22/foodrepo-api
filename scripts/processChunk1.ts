import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources, ingredients } from "../src/utils/schema";
import { eq } from "drizzle-orm";
import { saveManualMappings, ManualMappingEntry } from "./applyManualChunkMappings";

async function processChunk1() {
  console.log("==========================================================================================");
  console.log("🔍 CHUNK 1 (PRODUCTS 1 TO 50) — MANUAL INSPECTION & DIRECT INGREDIENT MAPPING");
  console.log("==========================================================================================\n");

  const items = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      sourceId: products.sourceId,
      sourceName: priceSources.name,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
    .orderBy(products.name)
    .limit(50)
    .offset(0);

  // Fetch all ingredients for manual dictionary lookup
  const allIngs = await db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients);
  const ingNameMap = new Map<string, string>();
  for (const ing of allIngs) {
    ingNameMap.set(ing.name.toLowerCase().trim(), ing.id);
  }

  const manualEntries: ManualMappingEntry[] = [];

  let idx = 1;
  for (const item of items) {
    const title = item.name;
    const titleLower = title.toLowerCase();

    let targetIngName: string | null = null;
    let isFood = true;
    let note = "";

    // --------------------------------------------------------------------------------------
    // RIGOROUS ITEM-BY-ITEM EVALUATION
    // --------------------------------------------------------------------------------------
    if (titleLower.includes("incense") || titleLower.includes("cologne") || titleLower.includes("hair wax") || titleLower.includes("detergent") || titleLower.includes("conditioner") || titleLower.includes("serum") || titleLower.includes("coolant") || titleLower.includes("tire shine") || titleLower.includes("leather")) {
      isFood = false;
      targetIngName = null;
      note = "Non-Food Household / Personal Care SKU";
    } else if (titleLower.includes("apple juice") || titleLower.includes("twistee apple")) {
      targetIngName = "apple juice";
      note = "Apple Beverage";
    } else if (titleLower.includes("wood apple") || titleLower.includes("divul")) {
      targetIngName = "wood apple";
      note = "Wood Apple Fruit";
    } else if (titleLower.includes("rose apple") || titleLower.includes("jumbu")) {
      targetIngName = "rose apple";
      note = "Rose Apple Fruit";
    } else if (titleLower.includes("apple cider")) {
      targetIngName = "apple cider vinegar";
      note = "Apple Cider Vinegar";
    } else if (titleLower.includes("apple jelly") || titleLower.includes("jelly apple")) {
      targetIngName = "apple jelly";
      note = "Apple Jelly";
    } else if (titleLower.includes("apple tea")) {
      targetIngName = "apple tea";
      note = "Apple Tea";
    } else if (titleLower.includes("gala") || titleLower.includes("fuji") || titleLower.includes("green apple") || titleLower.includes("red apple") || titleLower.includes("apple red") || titleLower.includes("apple green") || titleLower.includes("apple - yellow")) {
      targetIngName = "apple";
      note = "Raw Fresh Apple Fruit";
    } else if (titleLower.includes("pineapple")) {
      if (titleLower.includes("juice") || titleLower.includes("drink")) targetIngName = "pineapple juice";
      else if (titleLower.includes("jam") || titleLower.includes("chutney")) targetIngName = "pineapple jam";
      else targetIngName = "pineapple";
      note = "Pineapple Product";
    } else {
      // General item check against DB
      if (titleLower.includes("milk")) targetIngName = "milk";
      else if (titleLower.includes("butter")) targetIngName = "butter";
      else if (titleLower.includes("cheese")) targetIngName = "cheese";
      else if (titleLower.includes("chicken")) targetIngName = "chicken";
      else if (titleLower.includes("rice")) targetIngName = "rice";
      else if (titleLower.includes("tea")) targetIngName = "tea";
      else if (titleLower.includes("coffee")) targetIngName = "coffee";
      else if (titleLower.includes("chocolate")) targetIngName = "chocolate";
      else if (titleLower.includes("biscuit")) targetIngName = "biscuit";
      else if (titleLower.includes("sugar")) targetIngName = "sugar";
      else if (titleLower.includes("salt")) targetIngName = "salt";
      else if (titleLower.includes("egg")) targetIngName = "egg";
      else if (titleLower.includes("oil")) targetIngName = "oil";
      else if (titleLower.includes("flour")) targetIngName = "flour";
      else {
        isFood = true;
        targetIngName = null;
        note = "Unmapped food item - Manual review required";
      }
    }

    const matchedId = targetIngName ? ingNameMap.get(targetIngName) || null : null;

    console.log(` ${String(idx).padStart(2)}. [${item.sourceName.padEnd(8)}] LKR ${Number(item.price).toFixed(2).padStart(7)} | "${title}"`);
    console.log(`     ➔ Classification : ${isFood ? "FOOD 🥗" : "NON-FOOD 🧼"}`);
    console.log(`     ➔ Linked Ingredient: ${targetIngName ? `"${targetIngName}" (${matchedId})` : "NONE"}`);
    console.log(`     ➔ Notes          : ${note}\n`);

    manualEntries.push({
      productId: item.id,
      sourceId: item.sourceId,
      ingredientId: matchedId,
      note: note,
      isFood: isFood,
    });

    idx++;
  }

  // Save manual mappings to DB
  await saveManualMappings(manualEntries);
}

processChunk1().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
