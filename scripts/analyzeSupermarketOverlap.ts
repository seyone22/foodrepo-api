import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources } from "../src/utils/schema";
import { sql, eq, not, isNull, and } from "drizzle-orm";
import fs from "fs";
import path from "path";

interface MatchedGroup {
  key: string;
  matchType: "EAN" | "NormalizedName";
  ean?: string;
  name: string;
  stores: {
    storeName: string;
    productName: string;
    price: number;
    mrp: number | null;
    unit: string | null;
    url: string | null;
  }[];
}

async function analyzeSupermarketOverlap() {
  console.log("==========================================================================================");
  console.log("🇱🇰 COMPREHENSIVE SRI LANKAN SUPERMARKET OVERLAP & PRICE COMPARISON ANALYSIS");
  console.log("==========================================================================================");

  // 1. Fetch all active products with store names
  const allProducts = await db
    .select({
      id: products.id,
      name: products.name,
      brand: products.brand,
      unit: products.unit,
      quantity: products.quantity,
      price: products.price,
      mrp: products.mrp,
      eanBarcode: products.eanBarcode,
      sku: products.sku,
      url: products.url,
      sourceId: products.sourceId,
      sourceName: priceSources.name,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id));

  console.log(`\n📦 Total Raw SKUs loaded from Database: ${allProducts.length}`);

  // Group products by source
  const storeCounts: Record<string, number> = {};
  for (const p of allProducts) {
    storeCounts[p.sourceName] = (storeCounts[p.sourceName] || 0) + 1;
  }

  console.log("\n📊 Store Inventory Breakdown:");
  for (const [store, count] of Object.entries(storeCounts)) {
    console.log(`   - ${store.padEnd(20)}: ${count.toLocaleString()} SKUs`);
  }

  // 2. Barcode (EAN) Overlap Analysis
  const eanMap = new Map<string, typeof allProducts>();
  const invalidEans = new Set(["", "0", "null", "undefined", "0000000000000"]);

  for (const p of allProducts) {
    if (p.eanBarcode && !invalidEans.has(p.eanBarcode.trim())) {
      const ean = p.eanBarcode.trim();
      if (!eanMap.has(ean)) eanMap.set(ean, []);
      eanMap.get(ean)!.push(p);
    }
  }

  console.log(`\n🏷️ Total Unique EAN Barcodes Found: ${eanMap.size}`);

  // 3. Text Normalization Matching (for items without EAN or cross-verification)
  function normalizeTitle(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const nameMap = new Map<string, typeof allProducts>();
  for (const p of allProducts) {
    const norm = normalizeTitle(p.name);
    if (norm.length > 5) {
      if (!nameMap.has(norm)) nameMap.set(norm, []);
      nameMap.get(norm)!.push(p);
    }
  }

  // Combine EAN and Normalized Name Matching into unique Product Groups
  const matchedGroups: MatchedGroup[] = [];

  // Track processed product IDs to avoid duplicate grouping
  const processedProductIds = new Set<string>();

  // A. EAN Matches across multiple stores
  for (const [ean, prods] of eanMap.entries()) {
    // Filter to distinct stores per EAN match group
    const uniqueStoresMap = new Map<string, (typeof prods)[0]>();
    for (const p of prods) {
      // Pick lowest price if duplicate in same store
      if (!uniqueStoresMap.has(p.sourceName) || (p.price > 0 && p.price < uniqueStoresMap.get(p.sourceName)!.price)) {
        uniqueStoresMap.set(p.sourceName, p);
      }
    }

    if (uniqueStoresMap.size > 1) {
      const storeEntries = Array.from(uniqueStoresMap.values()).map((p) => {
        processedProductIds.add(p.id);
        return {
          storeName: p.sourceName,
          productName: p.name,
          price: p.price,
          mrp: p.mrp,
          unit: p.unit,
          url: p.url,
        };
      });

      matchedGroups.push({
        key: ean,
        matchType: "EAN",
        ean,
        name: prods[0].name,
        stores: storeEntries,
      });
    }
  }

  // B. Normalized Name Matches across multiple stores (for unprocessed items)
  for (const [normName, prods] of nameMap.entries()) {
    const unproc = prods.filter((p) => !processedProductIds.has(p.id));
    const uniqueStoresMap = new Map<string, (typeof prods)[0]>();

    for (const p of unproc) {
      if (!uniqueStoresMap.has(p.sourceName) || (p.price > 0 && p.price < uniqueStoresMap.get(p.sourceName)!.price)) {
        uniqueStoresMap.set(p.sourceName, p);
      }
    }

    if (uniqueStoresMap.size > 1) {
      const storeEntries = Array.from(uniqueStoresMap.values()).map((p) => {
        processedProductIds.add(p.id);
        return {
          storeName: p.sourceName,
          productName: p.name,
          price: p.price,
          mrp: p.mrp,
          unit: p.unit,
          url: p.url,
        };
      });

      matchedGroups.push({
        key: normName,
        matchType: "NormalizedName",
        name: prods[0].name,
        stores: storeEntries,
      });
    }
  }

  console.log(`\n🔗 Multi-Store Matched Product Groups Identified: ${matchedGroups.length}`);

  // 4. Distribution of Availability Across Supermarkets (1 store, 2 stores, 3 stores, etc.)
  const storeCountDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const exclusiveByStore: Record<string, number> = {};

  for (const storeName of Object.keys(storeCounts)) {
    exclusiveByStore[storeName] = 0;
  }

  // Count items present in only 1 store
  for (const p of allProducts) {
    if (!processedProductIds.has(p.id)) {
      storeCountDistribution[1]++;
      exclusiveByStore[p.sourceName] = (exclusiveByStore[p.sourceName] || 0) + 1;
    }
  }

  // Count items present in 2, 3, 4, 5 stores
  for (const g of matchedGroups) {
    const numStores = g.stores.length;
    storeCountDistribution[numStores] = (storeCountDistribution[numStores] || 0) + 1;
  }

  console.log("\n==========================================================================================");
  console.log("📈 SUPERMARKET PRODUCT OVERLAP DISTRIBUTION");
  console.log("==========================================================================================");
  console.log(`| Supermarket Coverage | Product Groups / SKUs | % of Total Catalogue |`);
  console.log(`|----------------------|-----------------------|----------------------|`);

  const totalGroupsAndExclusives = storeCountDistribution[1] + matchedGroups.length;

  for (let i = 1; i <= 5; i++) {
    const count = storeCountDistribution[i] || 0;
    const label = i === 1 ? "1 Store Only (Exclusive)" : `${i} Stores Overlap`;
    const pct = ((count / totalGroupsAndExclusives) * 100).toFixed(1);
    console.log(`| ${label.padEnd(20)} | ${String(count).padStart(21)} | ${(pct + "%").padStart(20)} |`);
  }

  console.log("\n==========================================================================================");
  console.log("🏬 EXCLUSIVE PRODUCTS BY SUPERMARKET (ONLY AVAILABLE IN THAT STORE)");
  console.log("==========================================================================================");
  for (const [store, excCount] of Object.entries(exclusiveByStore)) {
    const totalStoreSku = storeCounts[store] || 1;
    const excPct = ((excCount / totalStoreSku) * 100).toFixed(1);
    console.log(`   - ${store.padEnd(20)}: ${excCount.toLocaleString()} SKUs (${excPct}% of store catalog is exclusive)`);
  }

  // 5. Cross-Store Price Comparison Analysis
  console.log("\n==========================================================================================");
  console.log("💰 PRICE COMPARISON & INDEX ANALYSIS FOR OVERLAPPING PRODUCTS");
  console.log("==========================================================================================");

  // Store Price Comparison Pairings
  const storePriceSums: Record<string, { totalMatchedPrice: number; count: number; cheapestCount: number; expensiveCount: number }> = {};
  for (const storeName of Object.keys(storeCounts)) {
    storePriceSums[storeName] = { totalMatchedPrice: 0, count: 0, cheapestCount: 0, expensiveCount: 0 };
  }

  const priceDisparities: {
    name: string;
    matchType: string;
    numStores: number;
    minPrice: number;
    maxPrice: number;
    diffLkr: number;
    pctDiff: number;
    cheapestStore: string;
    expensiveStore: string;
    details: string;
  }[] = [];

  for (const g of matchedGroups) {
    const validStorePrices = g.stores.filter((s) => s.price > 0);
    if (validStorePrices.length < 2) continue;

    let minP = Infinity;
    let maxP = -Infinity;
    let cheapestS = "";
    let expensiveS = "";

    for (const s of validStorePrices) {
      if (s.price < minP) {
        minP = s.price;
        cheapestS = s.storeName;
      }
      if (s.price > maxP) {
        maxP = s.price;
        expensiveS = s.storeName;
      }
    }

    if (minP > 0 && maxP > minP) {
      const diffLkr = maxP - minP;
      const pctDiff = (diffLkr / minP) * 100;

      // Update store stats
      for (const s of validStorePrices) {
        storePriceSums[s.storeName].totalMatchedPrice += s.price;
        storePriceSums[s.storeName].count++;
      }

      storePriceSums[cheapestS].cheapestCount++;
      storePriceSums[expensiveS].expensiveCount++;

      const detailsStr = validStorePrices.map((s) => `${s.storeName}: LKR ${s.price.toFixed(2)}`).join(" | ");

      priceDisparities.push({
        name: g.name,
        matchType: g.matchType,
        numStores: validStorePrices.length,
        minPrice: minP,
        maxPrice: maxP,
        diffLkr,
        pctDiff,
        cheapestStore: cheapestS,
        expensiveStore: expensiveS,
        details: detailsStr,
      });
    }
  }

  // Sort by highest price difference percentage
  priceDisparities.sort((a, b) => b.pctDiff - a.pctDiff);

  console.log(`\n🏆 Supermarket Competitiveness Summary (Matched Basket Analysis):`);
  console.log(`| Supermarket         | Matched Items | # Times Lowest Price | # Times Highest Price | Avg Item Price |`);
  console.log(`|---------------------|---------------|----------------------|-----------------------|----------------|`);

  for (const [store, stats] of Object.entries(storePriceSums)) {
    if (stats.count === 0) continue;
    const avgP = (stats.totalMatchedPrice / stats.count).toFixed(2);
    console.log(
      `| ${store.padEnd(19)} | ${String(stats.count).padStart(13)} | ${String(stats.cheapestCount).padStart(20)} | ${String(
        stats.expensiveCount
      ).padStart(21)} | ${("LKR " + avgP).padStart(14)} |`
    );
  }

  console.log("\n==========================================================================================");
  console.log("🚨 TOP 15 LARGEST PRICE DISPARITIES FOR IDENTICAL PRODUCTS ACROSS STORES");
  console.log("==========================================================================================");

  for (let i = 0; i < Math.min(15, priceDisparities.length); i++) {
    const p = priceDisparities[i];
    console.log(`${i + 1}. ${p.name.slice(0, 50)}`);
    console.log(`   - Price Range: LKR ${p.minPrice.toFixed(2)} (${p.cheapestStore})  ➜  LKR ${p.maxPrice.toFixed(2)} (${p.expensiveStore})`);
    console.log(`   - Disparity: +LKR ${p.diffLkr.toFixed(2)} (+${p.pctDiff.toFixed(1)}% markup)`);
    console.log(`   - Store Prices: ${p.details}\n`);
  }

  // Save report artifact file to disk for easy reference
  const summaryReportPath = path.join(process.cwd(), "supermarket_overlap_report.json");
  fs.writeFileSync(
    summaryReportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalSkus: allProducts.length,
        storeCounts,
        storeCountDistribution,
        exclusiveByStore,
        totalMatchedGroups: matchedGroups.length,
        priceDisparitiesCount: priceDisparities.length,
        topDisparities: priceDisparities.slice(0, 50),
      },
      null,
      2
    )
  );

  console.log(`\n💾 Saved detailed report to ${summaryReportPath}`);
  console.log("==========================================================================================");
}

analyzeSupermarketOverlap()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
