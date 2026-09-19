import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { db } from "../src/utils/db";
import { ingredients } from "../src/utils/schema";
import { sql } from "drizzle-orm";
import { getDatabaseStats } from "../src/services/metaService";

const CONFIG = {
  GEMINI_MODEL: "gemini-flash-latest",
  BATCH_SIZE: 50,
  TARGET_COUNT: 20000,
  CONCURRENCY: 8,
  MAX_BUDGET_USD: 2.00,
};

const COST_FILE = path.join(process.cwd(), ".gemini_cumulative_cost.json");

let historicalInputTokens = 0;
let historicalOutputTokens = 0;
let historicalCostUSD = 0;

let sessionInputTokens = 0;
let sessionOutputTokens = 0;
let sessionCostUSD = 0;

let grandTotalCostUSD = 0;

function loadCostState() {
  if (fs.existsSync(COST_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(COST_FILE, "utf-8"));
      historicalInputTokens = data.totalInputTokens || 0;
      historicalOutputTokens = data.totalOutputTokens || 0;
      historicalCostUSD = data.cumulativeCostUSD || 0;
      grandTotalCostUSD = historicalCostUSD;
    } catch (e) {
      console.warn("⚠️ Could not parse cost file, starting fresh.");
    }
  }
}

function trackCostAndEnforceBudget(promptTokens: number, candidateTokens: number) {
  sessionInputTokens += promptTokens;
  sessionOutputTokens += candidateTokens;

  const sessionInputCost = (sessionInputTokens / 1_000_000) * 0.075;
  const sessionOutputCost = (sessionOutputTokens / 1_000_000) * 0.30;
  sessionCostUSD = sessionInputCost + sessionOutputCost;

  grandTotalCostUSD = historicalCostUSD + sessionCostUSD;

  // Persist updated cost state
  const costState = {
    totalInputTokens: historicalInputTokens + sessionInputTokens,
    totalOutputTokens: historicalOutputTokens + sessionOutputTokens,
    cumulativeCostUSD: grandTotalCostUSD,
    lastUpdated: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(COST_FILE, JSON.stringify(costState, null, 2));
  } catch (e) {
    // Ignore write issues
  }

  if (grandTotalCostUSD >= CONFIG.MAX_BUDGET_USD) {
    console.error(`\n🚨 BUDGET CIRCUIT BREAKER TRIGGERED! Cumulative API Cost reached $${grandTotalCostUSD.toFixed(4)} USD (Limit: $${CONFIG.MAX_BUDGET_USD.toFixed(2)} USD). Stopping execution.`);
    process.exit(1);
  }
}

function cleanJsonText(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  }
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }
  return cleaned;
}

function toSqlArray(arr: string[] | undefined) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(arr.map((x) => sql`${String(x)}`), sql`, `)}]::text[]`;
}

async function runEnrichment() {
  loadCostState();

  console.log("==========================================================================================");
  console.log(`🌐 HIGH-SPEED ENRICHMENT: ${CONFIG.TARGET_COUNT.toLocaleString()} RANDOM INGREDIENTS METADATA POPULATION`);
  console.log(`💰 HISTORICAL CUMULATIVE SPEND : $${historicalCostUSD.toFixed(4)} USD`);
  console.log(`🛡️ HARD STOP BUDGET CIRCUIT BREAKER: $${CONFIG.MAX_BUDGET_USD.toFixed(2)} USD`);
  console.log("==========================================================================================");

  const apiKey = process.env.GEMINI_API_KEY!;

  // Fetch TARGET_COUNT random ingredients missing metadata
  const targetIngredients = await db.execute(sql`
    SELECT id, name, aliases
    FROM ${ingredients}
    WHERE coalesce(cardinality(country), 0) = 0
       OR coalesce(cardinality(cuisine), 0) = 0
       OR coalesce(cardinality(region), 0) = 0
       OR coalesce(cardinality(flavor_profile), 0) = 0
    ORDER BY RANDOM()
    LIMIT ${CONFIG.TARGET_COUNT};
  `);

  console.log(`📦 Pulled ${targetIngredients.length.toLocaleString()} random ingredients missing metadata from DB.\n`);

  if (targetIngredients.length === 0) {
    console.log("🎉 All ingredients already have metadata!");
    return;
  }

  // Partition into batches of BATCH_SIZE (50)
  const batches: any[][] = [];
  for (let i = 0; i < targetIngredients.length; i += CONFIG.BATCH_SIZE) {
    batches.push(targetIngredients.slice(i, i + CONFIG.BATCH_SIZE));
  }

  let totalEnrichedCount = 0;
  let completedBatches = 0;

  async function processBatch(batch: any[], batchIdx: number) {
    const payload = batch.map((item) => ({
      id: item.id,
      name: item.name,
      aliases: item.aliases || [],
    }));

    const prompt = `
You are an expert culinary ethnographer & food scientist.
For each ingredient, assign accurate attributes based on culinary tradition, origin, and sensory profile:
1. "country": Primary countries of origin or culinary prevalence (e.g. ["Sri Lanka", "India"], ["Italy"], ["France"], ["Global"])
2. "cuisine": Cuisines where it is prominently used (e.g. ["Sri Lankan", "South Asian"], ["Italian", "Mediterranean"], ["Baking", "Dessert"])
3. "region": Geographical regions (e.g. ["South Asia"], ["Mediterranean"], ["Western Europe"], ["Global"])
4. "flavorProfile": Primary taste and sensory descriptors in lowercase (e.g. ["spicy", "aromatic", "savory"], ["sweet", "creamy", "rich"], ["tart", "citrusy"], ["earthy", "nutty"])

Return a strict JSON array where each object has: "id", "country", "cuisine", "region", "flavorProfile".

Ingredients Batch:
${JSON.stringify(payload, null, 2)}
`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        }
      );

      const responseData = await res.json();

      if (responseData.usageMetadata) {
        trackCostAndEnforceBudget(
          responseData.usageMetadata.promptTokenCount || 0,
          responseData.usageMetadata.candidatesTokenCount || 0
        );
      }

      const text = responseData?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (text) {
        const cleanedText = cleanJsonText(text);
        const enrichedItems = JSON.parse(cleanedText);

        // Parallel DB Updates for the batch
        await Promise.all(
          enrichedItems.map((item: any) =>
            db.execute(sql`
              UPDATE ${ingredients}
              SET country = ${toSqlArray(item.country)},
                  cuisine = ${toSqlArray(item.cuisine)},
                  region = ${toSqlArray(item.region)},
                  flavor_profile = ${toSqlArray(item.flavorProfile)},
                  provenance = 'AI_ENRICHED_GEMINI',
                  updated_at = NOW()
              WHERE id = ${item.id}::uuid;
            `)
          )
        );

        totalEnrichedCount += enrichedItems.length;
        completedBatches++;
        console.log(` ✅ Batch [${completedBatches}/${batches.length}] (${enrichedItems.length} items) enriched! Session: $${sessionCostUSD.toFixed(4)} USD | Grand Total: $${grandTotalCostUSD.toFixed(4)} USD`);
      }
    } catch (err: any) {
      console.error(` ❌ Batch #${batchIdx + 1} error:`, err.message || err);
    }
  }

  // Worker Pool Execution with Concurrency Limit
  let currentIdx = 0;
  async function worker() {
    while (currentIdx < batches.length) {
      const idx = currentIdx++;
      await processBatch(batches[idx], idx);
    }
  }

  const workers = Array.from({ length: CONFIG.CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log(`\n🎉 Successfully populated metadata for ${totalEnrichedCount.toLocaleString()} ingredients!`);
  console.log(` 💡 Session API Cost      : $${sessionCostUSD.toFixed(4)} USD`);
  console.log(` 🏆 Grand Cumulative Cost : $${grandTotalCostUSD.toFixed(4)} USD / $${CONFIG.MAX_BUDGET_USD.toFixed(2)} USD limit`);

  // Fetch updated stats
  const stats = await getDatabaseStats();
  console.log("\n==========================================================================================");
  console.log("📊 UPDATED DATA COMPLETENESS METRICS IN ADMIN DASHBOARD:");
  console.log("==========================================================================================");
  console.log(` • Missing Country : ${stats.dataCompleteness.missingCountry.toLocaleString()} ingredients`);
  console.log(` • Missing Cuisine : ${stats.dataCompleteness.missingCuisine.toLocaleString()} ingredients`);
  console.log(` • Missing Region  : ${stats.dataCompleteness.missingRegion.toLocaleString()} ingredients`);
  console.log(` • Missing Flavor  : ${stats.dataCompleteness.missingFlavor.toLocaleString()} ingredients`);
  console.log("==========================================================================================\n");
}

runEnrichment().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
