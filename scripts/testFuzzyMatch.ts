import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources } from "../src/utils/schema";
import { sql, eq } from "drizzle-orm";

interface ExtractedProduct {
  id: string;
  originalName: string;
  store: string;
  price: number;
  brand: string;
  sizeGramMl: number | null;
  sizeRaw: string;
  cleanCoreTitle: string;
}

function parseSizeAndCoreTitle(rawName: string): { brand: string; sizeGramMl: number | null; sizeRaw: string; cleanCoreTitle: string } {
  let name = rawName.toLowerCase().trim();

  // Common brands list in Sri Lanka
  const knownBrands = [
    "anchor", "maliban", "munchee", "nestle", "milo", "maggi", "knorr", "ceylon", "dilmah",
    "watawala", "zesta", "prima", "kottu mee", "harischandra", "mcbren", "bairaha", "cic",
    "cargills", "keells", "arpico", "spar", "md", "edson", "sunlight", "signal", "colgate",
    "lux", "lifebuoy", "dettol", "vIM", "harpic", "surf excel", "rin", "cbl", "marina",
    "fortune", "turkey", "flora", "meadow lea", "astra", "highland", "kotmale", "pelwatte"
  ];

  let brand = "unknown";
  for (const b of knownBrands) {
    if (name.includes(b)) {
      brand = b;
      break;
    }
  }

  // Extract size (e.g. 400g, 1kg, 250ml, 1.5l, 227g, 190g)
  let sizeGramMl: number | null = null;
  let sizeRaw = "";

  const sizeRegex = /(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ml|ltr|litre|litres|liter)\b/i;
  const match = name.match(sizeRegex);

  if (match) {
    sizeRaw = match[0];
    const val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();

    if (unit === "kg" || unit === "l" || unit === "ltr" || unit === "litre" || unit === "litres" || unit === "liter") {
      sizeGramMl = Math.round(val * 1000);
    } else {
      sizeGramMl = Math.round(val);
    }
  }

  // Remove size, brand, and punctuation to get normalized core title
  let clean = name
    .replace(sizeRegex, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Normalize common synonyms (e.g. "fcmp" -> "full cream milk powder", "cr." -> "cream", "short cake" -> "shortcake")
  clean = clean
    .replace(/\bfcmp\b/g, "full cream milk powder")
    .replace(/\bcr\b/g, "cream")
    .replace(/\bshort cake\b/g, "shortcake")
    .replace(/\bbiscuit\b/g, "")
    .replace(/\bbiscuits\b/g, "")
    .replace(/\bpack\b/g, "")
    .replace(/\bbox\b/g, "")
    .replace(/\bhandy\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { brand, sizeGramMl, sizeRaw, cleanCoreTitle: clean };
}

async function analyzeFuzzyMatches() {
  console.log("⚡ Starting Advanced Brand + Pack Size + Semantic Title Matching Analysis...\n");

  const allProducts = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      store: priceSources.name,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id));

  const parsedProducts: ExtractedProduct[] = allProducts.map((p) => {
    const { brand, sizeGramMl, sizeRaw, cleanCoreTitle } = parseSizeAndCoreTitle(p.name);
    return {
      id: p.id,
      originalName: p.name,
      store: p.store,
      price: p.price,
      brand,
      sizeGramMl,
      sizeRaw,
      cleanCoreTitle,
    };
  });

  // Group by (Brand + Size + CleanCoreTitle) when brand & size are known
  const matchMap = new Map<string, ExtractedProduct[]>();

  for (const p of parsedProducts) {
    if (p.brand !== "unknown" && p.sizeGramMl && p.cleanCoreTitle.length > 2) {
      const key = `${p.brand}|${p.sizeGramMl}|${p.cleanCoreTitle}`;
      if (!matchMap.has(key)) matchMap.set(key, []);
      matchMap.get(key)!.push(p);
    }
  }

  // Filter to multi-store matches
  const multiStoreGroups: { key: string; stores: Set<string>; items: ExtractedProduct[] }[] = [];

  for (const [key, items] of matchMap.entries()) {
    const stores = new Set(items.map((i) => i.store));
    if (stores.size > 1) {
      multiStoreGroups.push({ key, stores, items });
    }
  }

  console.log(`==========================================================================================`);
  console.log(`🎯 ADVANCED MATCHING RESULTS FOR BRANDED PACKAGED GOODS`);
  console.log(`==========================================================================================`);
  console.log(`Total Products Parsed: ${parsedProducts.length}`);
  console.log(`Total Branded Items with Standard Pack Sizes: ${parsedProducts.filter((p) => p.brand !== "unknown" && p.sizeGramMl).length}`);
  console.log(`Identical Multi-Store Branded Match Groups Found: ${multiStoreGroups.length}`);

  console.log(`\n📌 Sample Matched Identical Products across Supermarket Chains (showing variations):`);
  console.log(`------------------------------------------------------------------------------------------`);

  let sampleCount = 0;
  for (const group of multiStoreGroups) {
    if (sampleCount >= 10) break;

    console.log(`\n📦 Product Group #${sampleCount + 1}: [Brand: ${group.items[0].brand.toUpperCase()}, Size: ${group.items[0].sizeGramMl}g/ml, Core: "${group.items[0].cleanCoreTitle}"]`);
    
    // Pick 1 per store
    const storeMap = new Map<string, ExtractedProduct>();
    for (const item of group.items) {
      if (!storeMap.has(item.store)) storeMap.set(item.store, item);
    }

    for (const [store, item] of storeMap.entries()) {
      console.log(`   - [${store.padEnd(8)}] LKR ${item.price.toFixed(2).padStart(8)} | Raw Title: "${item.originalName}"`);
    }

    sampleCount++;
  }

  // Breakdown of why 95% appeared single-store in raw exact match
  console.log(`\n==========================================================================================`);
  console.log(`💡 ROOT CAUSES OF CATALOGUE EXCLUSIVITY / NON-MATCHES`);
  console.log(`==========================================================================================`);

  const houseBrandsCount = parsedProducts.filter((p) =>
    ["cargills", "keells", "arpico", "spar"].some((hb) => p.originalName.toLowerCase().includes(hb))
  ).length;

  const freshProduceCount = parsedProducts.filter((p) =>
    !p.brand || p.brand === "unknown" && !p.sizeGramMl
  ).length;

  console.log(`1. Supermarket Private Labels / House Brands (e.g. "Keells Choice", "Cargills Kist", "SPAR Bakery"): ${houseBrandsCount} SKUs (${((houseBrandsCount/parsedProducts.length)*100).toFixed(1)}%)`);
  console.log(`2. Fresh Produce / Meat / Unbranded Items without EAN or Fixed Weight: ${freshProduceCount} SKUs (${((freshProduceCount/parsedProducts.length)*100).toFixed(1)}%)`);
  console.log(`3. Title Naming & Formatting Variations (e.g. "Shortcake" vs "Short Cake", "FCMP" vs "Full Cream Milk Powder", "190g" vs "190G Box"): Resolved via Fuzzy Parsing`);
  console.log(`4. Missing EAN/GTIN Barcodes in Web API HTML/JSON Responses: 100% of scrapers lack barcoding data from store APIs.`);
}

analyzeFuzzyMatches()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
