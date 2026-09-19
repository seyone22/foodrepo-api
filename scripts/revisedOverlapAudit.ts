import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources } from "../src/utils/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

interface RawProduct {
  id: string;
  name: string;
  brand: string | null;
  price: number;
  mrp: number | null;
  unit: string | null;
  store: string;
}

interface ParsedProduct extends RawProduct {
  extractedBrand: string;
  sizeGramMl: number | null;
  cleanTokens: string[];
  canonicalKey: string;
}

const KNOWN_BRANDS = [
  "anchor", "maliban", "munchee", "nestle", "milo", "maggi", "knorr", "ceylon", "dilmah",
  "watawala", "zesta", "prima", "kottu mee", "harischandra", "mcbren", "bairaha", "cic",
  "cargills", "keells", "arpico", "spar", "md", "edson", "sunlight", "signal", "colgate",
  "lux", "lifebuoy", "dettol", "vim", "harpic", "surf excel", "rin", "cbl", "marina",
  "fortune", "turkey", "flora", "meadow lea", "astra", "highland", "kotmale", "pelwatte",
  "kist", "delmege", "edinborough", "elephant house", "smak", "mymaid", "md", "lipton",
  "red cow", "ratthi", "lakspray", "sustain", "pediapro", "horlicks", "viva", "complan",
  "sensodyne", "pepsodent", "dettol", "dora", "panda baby", "baby cheramy", "khomba",
  "dignity", "eva", "velona", "fems", "whisper", "comfort", "vivera", "gillette"
];

const NOISE_WORDS = new Set([
  "box", "pkt", "packet", "pouch", "bib", "tetra", "canister", "tin", "refill", "handy",
  "free", "promo", "pack", "packs", "bottle", "bot", "jar", "container", "sachet", "tube",
  "supermarket", "keells", "arpico", "spar", "cargills", "glomark", "sri", "lanka", "lankan"
]);

function normalizeProduct(p: RawProduct): ParsedProduct {
  let lower = p.name.toLowerCase().trim();

  // 1. Extract Brand
  let extractedBrand = "unbranded";
  if (p.brand && p.brand.trim() && p.brand.toLowerCase() !== "n/a" && p.brand.toLowerCase() !== "spar sri lanka") {
    extractedBrand = p.brand.toLowerCase().trim();
  } else {
    for (const b of KNOWN_BRANDS) {
      if (lower.includes(b)) {
        extractedBrand = b;
        break;
      }
    }
  }

  // 2. Extract Pack Size in grams / ml
  let sizeGramMl: number | null = null;
  const sizeRegex = /(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ml|ltr|litre|litres|liter)\b/i;
  const match = lower.match(sizeRegex);

  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (["kg", "l", "ltr", "litre", "litres", "liter"].includes(unit)) {
      sizeGramMl = Math.round(val * 1000);
    } else {
      sizeGramMl = Math.round(val);
    }
  }

  // 3. Clean tokens
  let cleanStr = lower
    .replace(sizeRegex, "")
    .replace(/\bfcmp\b/g, "full cream milk powder")
    .replace(/\bcr\b/g, "cream")
    .replace(/\bflv\b/g, "flavoured")
    .replace(/\bchoc\b/g, "chocolate")
    .replace(/\bshort cake\b/g, "shortcake")
    .replace(/\burg\b/g, "yoghurt")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleanStr
    .split(" ")
    .filter((t) => t.length > 1 && !NOISE_WORDS.has(t) && t !== extractedBrand);

  tokens.sort(); // Order-independent token key
  const canonicalKey = `${extractedBrand}|${sizeGramMl || "nosize"}|${tokens.join("_")}`;

  return {
    ...p,
    extractedBrand,
    sizeGramMl,
    cleanTokens: tokens,
    canonicalKey,
  };
}

// Token Jaccard Similarity between two token lists
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const elem of setA) {
    if (setB.has(elem)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

async function runRevisedOverlapAudit() {
  console.log("==========================================================================================");
  console.log("🚀 REVISED SRI LANKAN SUPERMARKET OVERLAP AUDIT (SEMANTIC & FUZZY MATCHED)");
  console.log("==========================================================================================");

  const rawProducts = await db
    .select({
      id: products.id,
      name: products.name,
      brand: products.brand,
      price: products.price,
      mrp: products.mrp,
      unit: products.unit,
      store: priceSources.name,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id));

  console.log(`📦 Loaded ${rawProducts.length} raw SKUs from database.`);

  const parsedProducts: ParsedProduct[] = rawProducts.map(normalizeProduct);

  // Grouping Phase 1: Canonical Exact Key (Brand + Normalized Size + Sorted Tokens)
  const canonicalGroupsMap = new Map<string, ParsedProduct[]>();

  for (const p of parsedProducts) {
    if (!canonicalGroupsMap.has(p.canonicalKey)) {
      canonicalGroupsMap.set(p.canonicalKey, []);
    }
    canonicalGroupsMap.get(p.canonicalKey)!.push(p);
  }

  // Phase 2: Secondary Fuzzy Pass across groups with same Brand & Size
  const brandSizeBuckets = new Map<string, ParsedProduct[]>();

  for (const p of parsedProducts) {
    if (p.extractedBrand !== "unbranded" && p.sizeGramMl) {
      const bucketKey = `${p.extractedBrand}|${p.sizeGramMl}`;
      if (!brandSizeBuckets.has(bucketKey)) {
        brandSizeBuckets.set(bucketKey, []);
      }
      brandSizeBuckets.get(bucketKey)!.push(p);
    }
  }

  // Cluster fuzzy matches within same Brand & Size
  const finalClusters: ParsedProduct[][] = [];
  const processedIds = new Set<string>();

  for (const [bucketKey, bucketProducts] of brandSizeBuckets.entries()) {
    for (let i = 0; i < bucketProducts.length; i++) {
      const p1 = bucketProducts[i];
      if (processedIds.has(p1.id)) continue;

      const cluster: ParsedProduct[] = [p1];
      processedIds.add(p1.id);

      for (let j = i + 1; j < bucketProducts.length; j++) {
        const p2 = bucketProducts[j];
        if (processedIds.has(p2.id)) continue;

        const sim = jaccardSimilarity(p1.cleanTokens, p2.cleanTokens);
        // High similarity threshold for identical items within same brand & size
        if (sim >= 0.5 || p1.canonicalKey === p2.canonicalKey) {
          cluster.push(p2);
          processedIds.add(p2.id);
        }
      }

      finalClusters.push(cluster);
    }
  }

  // Add remaining unclustered products as individual items or canonical groups
  for (const p of parsedProducts) {
    if (!processedIds.has(p.id)) {
      finalClusters.push([p]);
      processedIds.add(p.id);
    }
  }

  console.log(`\n✅ Clustering Complete! Total Product Clusters Identified: ${finalClusters.length}`);

  // Calculate Overlap Statistics
  const storeDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const multiStoreClusters: ParsedProduct[][] = [];
  const exclusiveStoreCounts: Record<string, number> = {};

  for (const cluster of finalClusters) {
    const storesInCluster = new Set(cluster.map((c) => c.store));
    const storeCount = storesInCluster.size;

    storeDistribution[storeCount] = (storeDistribution[storeCount] || 0) + 1;

    if (storeCount > 1) {
      multiStoreClusters.push(cluster);
    } else {
      const singleStore = cluster[0].store;
      exclusiveStoreCounts[singleStore] = (exclusiveStoreCounts[singleStore] || 0) + cluster.length;
    }
  }

  console.log("\n==========================================================================================");
  console.log("📊 REVISED OVERLAP DISTRIBUTION TABLE (FUZZY & SEMANTIC NORM)");
  console.log("==========================================================================================");
  console.log(`| Supermarket Coverage | Product Clusters | % of Product Line | Raw SKUs Included |`);
  console.log(`|----------------------|------------------|-------------------|-------------------|`);

  const totalClusters = finalClusters.length;

  for (let i = 1; i <= 5; i++) {
    const count = storeDistribution[i] || 0;
    const label = i === 1 ? "1 Store Only (Exclusive)" : `${i} Stores Overlap`;
    const pct = ((count / totalClusters) * 100).toFixed(1);
    
    // Count raw SKUs in these clusters
    const rawSkuCount = finalClusters
      .filter((c) => new Set(c.map((item) => item.store)).size === i)
      .reduce((sum, c) => sum + c.length, 0);

    console.log(`| ${label.padEnd(20)} | ${String(count).padStart(16)} | ${(pct + "%").padStart(17)} | ${String(rawSkuCount).padStart(17)} |`);
  }

  // Multi-Store Price Index Analysis
  console.log("\n==========================================================================================");
  console.log("💰 REVISED SUPERMARKET PRICE COMPETITIVENESS INDEX");
  console.log("==========================================================================================");

  const storeStats: Record<string, { totalMatchedPrice: number; count: number; cheapestCount: number; expensiveCount: number }> = {};
  for (const cluster of multiStoreClusters) {
    const validPrices = cluster.filter((c) => c.price > 0);
    const storeMap = new Map<string, number>();

    for (const item of validPrices) {
      // Pick min price if duplicate in same store cluster
      if (!storeMap.has(item.store) || item.price < storeMap.get(item.store)!) {
        storeMap.set(item.store, item.price);
      }
    }

    if (storeMap.size < 2) continue;

    let minP = Infinity;
    let maxP = -Infinity;
    let cheapest = "";
    let expensive = "";

    for (const [store, p] of storeMap.entries()) {
      if (!storeStats[store]) {
        storeStats[store] = { totalMatchedPrice: 0, count: 0, cheapestCount: 0, expensiveCount: 0 };
      }
      storeStats[store].totalMatchedPrice += p;
      storeStats[store].count++;

      if (p < minP) {
        minP = p;
        cheapest = store;
      }
      if (p > maxP) {
        maxP = p;
        expensive = store;
      }
    }

    if (cheapest) storeStats[cheapest].cheapestCount++;
    if (expensive && expensive !== cheapest) storeStats[expensive].expensiveCount++;
  }

  console.log(`| Supermarket   | Matched Products | # Lowest Price (% Won) | # Highest Price | Avg Matched Price |`);
  console.log(`|---------------|------------------|------------------------|-----------------|-------------------|`);

  for (const [store, stats] of Object.entries(storeStats)) {
    const avgP = (stats.totalMatchedPrice / stats.count).toFixed(2);
    const pctWon = ((stats.cheapestCount / stats.count) * 100).toFixed(1);
    const cheapestStr = `${stats.cheapestCount} (${pctWon}%)`;
    console.log(
      `| ${store.padEnd(13)} | ${String(stats.count).padStart(16)} | ${cheapestStr.padStart(22)} | ${String(
        stats.expensiveCount
      ).padStart(15)} | ${("LKR " + avgP).padStart(17)} |`
    );
  }

  // Write summary to JSON
  const reportPath = path.join(process.cwd(), "revised_supermarket_overlap_report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalRawSkus: rawProducts.length,
        totalClusters,
        storeDistribution,
        multiStoreClustersCount: multiStoreClusters.length,
        storeStats,
      },
      null,
      2
    )
  );

  console.log(`\n💾 Saved revised report to ${reportPath}`);
  console.log("==========================================================================================");
}

runRevisedOverlapAudit()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
