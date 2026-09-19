import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { db } from "../src/utils/db";
import { ingredients } from "../src/utils/schema";
import { sql } from "drizzle-orm";

const CONFIG = {
  GEMINI_MODEL: "gemini-flash-latest",
  BATCH_SIZE: 30,
  CONCURRENCY: 6,
  MAX_BUDGET_USD: 2.00,
};

const COST_FILE = path.join(process.cwd(), ".gemini_cumulative_cost.json");

interface CostState {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
}

function loadCostState(): CostState {
  if (fs.existsSync(COST_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(COST_FILE, "utf-8"));
      return {
        inputTokens: data.inputTokens || 0,
        outputTokens: data.outputTokens || 0,
        totalCostUsd: data.totalCostUsd || 0,
      };
    } catch (e) {
      console.warn("⚠️ Failed to parse cost file, initializing fresh state.");
    }
  }
  return { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
}

function saveCostState(state: CostState) {
  fs.writeFileSync(COST_FILE, JSON.stringify(state, null, 2), "utf-8");
}

let globalCostState = loadCostState();

function trackCostAndEnforceBudget(promptTokens: number, candidateTokens: number) {
  const inputCost = (promptTokens / 1_000_000) * 0.075;
  const outputCost = (candidateTokens / 1_000_000) * 0.30;
  const callCost = inputCost + outputCost;

  globalCostState.inputTokens += promptTokens;
  globalCostState.outputTokens += candidateTokens;
  globalCostState.totalCostUsd += callCost;

  saveCostState(globalCostState);

  if (globalCostState.totalCostUsd >= CONFIG.MAX_BUDGET_USD) {
    console.error(`\n🚨 HARD BUDGET CIRCUIT BREAKER TRIGGERED! Total Cost: $${globalCostState.totalCostUsd.toFixed(4)} USD >= Limit $${CONFIG.MAX_BUDGET_USD} USD.`);
    process.exit(1);
  }

  return callCost;
}

function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  }
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }
  return cleaned;
}

interface IndianItem {
  id: string;
  name: string;
  country: string[] | null;
  cuisine: string[] | null;
  region: string[] | null;
}

interface EnrichedIndianItem {
  id: string;
  country: string[];
  cuisine: string[];
  region: string[];
}

async function enrichIndianBatch(apiKey: string, batch: IndianItem[]): Promise<EnrichedIndianItem[]> {
  const prompt = `You are an expert culinary historian and ethnobotanist specializing in South Asian / Indian regional cuisines and geography.
Given this array of ${batch.length} South Asian food items, enrich each item with precise multi-tiered hierarchical arrays for:
1. "country": array of origin country strings (e.g. ["India"], ["Sri Lanka"], ["Pakistan"], ["Bangladesh"], ["Nepal"]).
2. "region": hierarchical array from macro-region down to specific sub-region / state / province / terroir.
   Examples for region:
   - Sambhar powder / Curry leaves / Mustard seeds (South): ["South Asia", "India", "South India", "Tamil Nadu", "Kerala"]
   - Garam Masala / Tandoori / Paneer (North): ["South Asia", "India", "North India", "Punjab"]
   - Panch Phoron / Mustard paste / Bengal Dal (East): ["South Asia", "India", "East India", "Bengal"]
   - Kokum / Poha / Pav Bhaji (West): ["South Asia", "India", "West India", "Maharashtra", "Gujarat"]
   - Ceylon Cinnamon / Goraka / Hopper (Sri Lanka): ["South Asia", "Sri Lanka", "Southern Province"]
   - Pan-Indian staples (Turmeric, Cumin, Basmati Rice): ["South Asia", "India", "Pan-Indian"]
3. "cuisine": hierarchical array from broad culinary tradition down to specific regional sub-cuisine.
   Examples for cuisine:
   - ["Indian", "South Indian", "Tamil", "Chettinad"]
   - ["Indian", "North Indian", "Punjabi", "Mughlai"]
   - ["Indian", "Bengali", "East Indian"]
   - ["Indian", "Gujarati", "Maharashtrian"]
   - ["Sri Lankan", "Ceylonese", "South Asian"]

INPUT ITEMS:
${JSON.stringify(batch.map((b) => ({ id: b.id, name: b.name })), null, 2)}

Return ONLY a valid JSON array of objects with keys: "id", "country", "cuisine", "region".
No preamble, markdown fences, or conversational text. Format:
[
  {
    "id": "...",
    "country": ["India"],
    "region": ["South Asia", "India", "South India", "Tamil Nadu"],
    "cuisine": ["Indian", "South Indian", "Tamil"]
  }
]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.warn(`⚠️ Gemini API HTTP ${response.status}: ${errText}`);
    return [];
  }

  const resJson = await response.json();
  const usage = resJson.usageMetadata || {};
  trackCostAndEnforceBudget(usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);

  const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const cleaned = cleanJsonText(rawText);

  try {
    return JSON.parse(cleaned) as EnrichedIndianItem[];
  } catch (err) {
    // Attempt simple repair for unescaped newlines or trailing commas
    try {
      const repaired = cleaned.replace(/,\s*([\]}])/g, "$1").replace(/\n/g, " ");
      return JSON.parse(repaired) as EnrichedIndianItem[];
    } catch (e) {
      console.warn("⚠️ JSON Parse Error on batch, skipping batch.");
      return [];
    }
  }
}

async function runIndianEnrichment() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY is not set in environment!");
    process.exit(1);
  }

  console.log("==========================================================================================");
  console.log("🌶️ DEEP REGIONAL ENRICHMENT: SOUTH ASIAN & INDIAN SUB-REGIONAL HIERARCHY");
  console.log(`💰 HISTORICAL CUMULATIVE SPEND : $${globalCostState.totalCostUsd.toFixed(4)} USD`);
  console.log(`🛡️ HARD STOP BUDGET CIRCUIT BREAKER: $${CONFIG.MAX_BUDGET_USD.toFixed(2)} USD`);
  console.log("==========================================================================================");

  // Query all South Asian / Indian ingredients in DB
  const rawItems = await db.execute(sql`
    SELECT id, name, country, cuisine, region
    FROM ${ingredients}
    WHERE 'Indian' = ANY(cuisine)
       OR 'South Asian' = ANY(cuisine)
       OR 'India' = ANY(country)
       OR 'Sri Lanka' = ANY(country)
       OR 'Pakistan' = ANY(country)
       OR 'Bangladesh' = ANY(country);
  `);

  const items = rawItems as unknown as IndianItem[];
  console.log(`📦 Pulled ${items.length} South Asian / Indian ingredients to enrich with regional hierarchy.\n`);

  if (items.length === 0) {
    console.log("✨ No items found matching criteria.");
    process.exit(0);
  }

  // Chunk into batches of 30
  const batches: IndianItem[][] = [];
  for (let i = 0; i < items.length; i += CONFIG.BATCH_SIZE) {
    batches.push(items.slice(i, i + CONFIG.BATCH_SIZE));
  }

  let completedBatches = 0;

  for (let i = 0; i < batches.length; i += CONFIG.CONCURRENCY) {
    const chunk = batches.slice(i, i + CONFIG.CONCURRENCY);
    const promises = chunk.map((batch) => enrichIndianBatch(apiKey, batch));

    const results = await Promise.all(promises);

    for (const enrichedArray of results) {
      completedBatches++;
      for (const item of enrichedArray) {
        if (!item.id || !Array.isArray(item.region) || !Array.isArray(item.cuisine)) continue;

        const countrySql = item.country && item.country.length > 0
          ? sql`ARRAY[${sql.join(item.country.map((x) => sql`${String(x)}`), sql`, `)}]::text[]`
          : sql`country`;

        const cuisineSql = item.cuisine && item.cuisine.length > 0
          ? sql`ARRAY[${sql.join(item.cuisine.map((x) => sql`${String(x)}`), sql`, `)}]::text[]`
          : sql`cuisine`;

        const regionSql = item.region && item.region.length > 0
          ? sql`ARRAY[${sql.join(item.region.map((x) => sql`${String(x)}`), sql`, `)}]::text[]`
          : sql`region`;

        await db.execute(sql`
          UPDATE ${ingredients}
          SET country = ${countrySql},
              cuisine = ${cuisineSql},
              region = ${regionSql},
              provenance = 'AI_ENRICHED_GEMINI_INDIAN_HIERARCHY',
              updated_at = NOW()
          WHERE id = ${item.id}::uuid;
        `);
      }

      console.log(` ✅ Batch [${completedBatches}/${batches.length}] enriched with deep sub-region hierarchy! Cumulative Spend: $${globalCostState.totalCostUsd.toFixed(4)} USD`);
    }
  }

  console.log("\n🎉 Successfully enriched all South Asian & Indian ingredients with regional sub-hierarchies!");
  console.log(` 🏆 Grand Cumulative Cost : $${globalCostState.totalCostUsd.toFixed(4)} USD / $${CONFIG.MAX_BUDGET_USD.toFixed(2)} USD limit`);
}

runIndianEnrichment().then(() => process.exit(0)).catch((err) => {
  console.error("❌ Fatal Pipeline Error:", err);
  process.exit(1);
});
