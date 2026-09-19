import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { db } from "../src/utils/db";
import { products, priceSources, ingredients, mappings } from "../src/utils/schema";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const CONFIG = {
  GEMINI_MODEL: "gemini-flash-latest",
  BATCH_SIZE: 50,
  CONCURRENCY: 4, // 4 parallel batch workers
  MAX_BUDGET_USD: 2.00, // Hard stop limit requested by user
};

let totalInputTokens = 0;
let totalOutputTokens = 0;
let cumulativeCostUSD = 0;

function trackCostAndEnforceBudget(promptTokens: number, candidateTokens: number) {
  totalInputTokens += promptTokens;
  totalOutputTokens += candidateTokens;

  // Gemini 2.5 Flash pricing: $0.075 / 1M input, $0.30 / 1M output
  const inputCost = (totalInputTokens / 1_000_000) * 0.075;
  const outputCost = (totalOutputTokens / 1_000_000) * 0.30;
  cumulativeCostUSD = inputCost + outputCost;

  if (cumulativeCostUSD >= CONFIG.MAX_BUDGET_USD) {
    console.error(`\n🚨 BUDGET CIRCUIT BREAKER TRIGGERED!`);
    console.error(` Total API Cost reached $${cumulativeCostUSD.toFixed(4)} USD (Limit: $${CONFIG.MAX_BUDGET_USD.toFixed(2)} USD).`);
    console.error(` Terminating AI pipeline immediately to prevent cost overrun.\n`);
    process.exit(1);
  }
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Schema for Gemini Batch Verification Response
const batchResultSchema = z.array(
  z.object({
    productId: z.string(),
    matchedIngredientIds: z.array(z.string()),
    confidence: z.number(),
    isFood: z.boolean(),
    reason: z.string().optional().default(""),
  })
);

// ----------------------------------------------------------------------
// 1. NON-FOOD FAST CLASSIFIER
// ----------------------------------------------------------------------
const NON_FOOD_REGEX = /\b(detergent|shampoo|conditioner|soap|face wash|lotion|cologne|spray|perfume|deodorant|diaper|sanitary|napkin|tissue|paper towel|disinfectant|floor cleaner|cleaner|dishwash|bleach|coolant|car care|leather|tire shine|radiator|bulb|battery|balloon|balloons|stationery|pencil|pen|notebook|dog food|cat food|pet food|broom|mop|insecticide|mosquito|bug spray|toothbrush|toothpaste|mouthwash|retinol|serum|skincare|moisturizer|sunscreen|hair color|hair dye|razor|shaving|cotton buds|bandage|plaster|polish|air freshener|wipes)\b/i;

function isNonFoodItem(title: string): boolean {
  return NON_FOOD_REGEX.test(title);
}

// ----------------------------------------------------------------------
// 2. IN-MEMORY LEXICAL INGREDIENT CANDIDATE RETRIEVER
// ----------------------------------------------------------------------
interface InMemIngredient {
  id: string;
  name: string;
  aliases: string[];
  tokens: Set<string>;
}

let INGREDIENT_CACHE: InMemIngredient[] = [];
let INVERTED_INDEX: Map<string, InMemIngredient[]> = new Map();
let EXACT_NAME_MAP: Map<string, string> = new Map(); // normalized name -> ingredient ID

function buildIngredientIndex(rawIngs: { id: string; name: string; aliases: string[] | null }[]) {
  console.log("⚡ Building In-Memory Candidate Search Index for 20,833 Ingredients...");

  for (const ing of rawIngs) {
    const aliasList = ing.aliases || [];
    const normName = ing.name.toLowerCase().trim();
    EXACT_NAME_MAP.set(normName, ing.id);

    for (const a of aliasList) {
      if (a && a.trim().length > 1) {
        EXACT_NAME_MAP.set(a.toLowerCase().trim(), ing.id);
      }
    }

    const allText = `${ing.name} ${aliasList.join(" ")}`.toLowerCase();

    const tokens = new Set(
      allText
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2)
    );

    const item: InMemIngredient = {
      id: ing.id,
      name: ing.name,
      aliases: aliasList,
      tokens,
    };

    INGREDIENT_CACHE.push(item);

    for (const t of tokens) {
      if (!INVERTED_INDEX.has(t)) INVERTED_INDEX.set(t, []);
      INVERTED_INDEX.get(t)!.push(item);
    }
  }

  console.log(`✅ Index built with ${INVERTED_INDEX.size} distinct search tokens & ${EXACT_NAME_MAP.size} exact lookup keys.`);
}

function getTopCandidates(productTitle: string, limit = 8): { id: string; name: string }[] {
  const cleanTitleTokens = productTitle
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ml|ltr|litre|litres|liter)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scores = new Map<string, { item: InMemIngredient; score: number }>();

  for (const token of cleanTitleTokens) {
    const matches = INVERTED_INDEX.get(token) || [];
    for (const item of matches) {
      if (!scores.has(item.id)) {
        scores.set(item.id, { item, score: 0 });
      }

      const rec = scores.get(item.id)!;
      if (item.name.toLowerCase() === token) {
        rec.score += 5;
      } else if (item.name.toLowerCase().includes(token)) {
        rec.score += 2;
      } else {
        rec.score += 1;
      }
    }
  }

  const sorted = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return sorted.map((s) => ({ id: s.item.id, name: s.item.name }));
}

function tryExactRuleMatch(productTitle: string): string | null {
  const clean = productTitle
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ml|ltr|litre|litres|liter)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (EXACT_NAME_MAP.has(clean)) return EXACT_NAME_MAP.get(clean)!;

  // Try matching words
  for (const [key, ingId] of EXACT_NAME_MAP.entries()) {
    if (key.length > 3 && clean === key) {
      return ingId;
    }
  }

  return null;
}

// ----------------------------------------------------------------------
// 3. MAIN PIPELINE EXECUTION
// ----------------------------------------------------------------------
async function runPipeline() {
  console.log("==========================================================================================");
  console.log("🚀 STARTING FULL HIGH-EFFICIENCY AI SUPERMARKET INGREDIENT MAPPING PIPELINE");
  console.log("==========================================================================================");

  // Fetch all canonical ingredients
  const allIngredients = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      aliases: ingredients.aliases,
    })
    .from(ingredients);

  buildIngredientIndex(allIngredients);

  // Fetch all products
  const allProducts = await db
    .select({
      id: products.id,
      name: products.name,
      sourceId: products.sourceId,
      sourceName: priceSources.name,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id));

  console.log(`\n📦 Total Products loaded from DB: ${allProducts.length}`);

  // Fetch checkpoint mapped IDs
  const existingMapped = await db
    .select({ productId: mappings.productId })
    .from(mappings);
  const mappedSet = new Set(existingMapped.map((m) => m.productId));

  console.log(`ℹ️ Already Mapped Products (Checkpoint): ${mappedSet.size} SKUs`);

  const pendingProducts = allProducts.filter((p) => !mappedSet.has(p.id));
  console.log(`⚡ Pending Products to Process: ${pendingProducts.length} SKUs\n`);

  if (pendingProducts.length === 0) {
    console.log("🎉 All products are already mapped!");
    return;
  }

  // Separate Non-Food, Exact Rule Matches, and AI Queue
  const nonFoodItems: typeof pendingProducts = [];
  const exactRuleItems: { product: typeof pendingProducts[0]; ingredientId: string }[] = [];
  const aiItems: typeof pendingProducts = [];

  for (const p of pendingProducts) {
    if (isNonFoodItem(p.name)) {
      nonFoodItems.push(p);
    } else {
      const ruleIngId = tryExactRuleMatch(p.name);
      if (ruleIngId) {
        exactRuleItems.push({ product: p, ingredientId: ruleIngId });
      } else {
        aiItems.push(p);
      }
    }
  }

  console.log(`🚫 Non-Food Items (Rule $0 cost): ${nonFoodItems.length} SKUs`);
  console.log(`⚡ Exact Ingredient Name Matches (Rule $0 cost): ${exactRuleItems.length} SKUs`);
  console.log(`🤖 AI Queue for Gemini 2.5 Flash Verification: ${aiItems.length} SKUs\n`);

  // Insert Non-Food Mappings using Raw SQL
  if (nonFoodItems.length > 0) {
    console.log("💾 Saving Non-Food Mappings to Database...");
    for (let i = 0; i < nonFoodItems.length; i += 500) {
      const chunk = nonFoodItems.slice(i, i + 500);
      const query = sql`
        INSERT INTO ${mappings} (id, product_id, source_id, matched_ingredients, confidence, method, notes, meta, created_at, updated_at)
        VALUES ${sql.join(
          chunk.map(
            (p) => sql`(gen_random_uuid(), ${p.id}::uuid, ${p.sourceId}::uuid, ARRAY[]::uuid[], 1.0, 'non_food_rule', 'Non-food SKU classification', '{"isFood": false}'::jsonb, NOW(), NOW())`
          ),
          sql`, `
        )}
        ON CONFLICT (product_id, source_id) DO NOTHING;
      `;
      await db.execute(query);
    }
    console.log(`✅ Saved ${nonFoodItems.length} Non-Food SKU mappings.`);
  }

  // Insert Exact Rule Mappings using Raw SQL
  if (exactRuleItems.length > 0) {
    console.log("💾 Saving Exact Rule Mappings to Database...");
    for (let i = 0; i < exactRuleItems.length; i += 500) {
      const chunk = exactRuleItems.slice(i, i + 500);
      const query = sql`
        INSERT INTO ${mappings} (id, product_id, source_id, matched_ingredients, confidence, method, notes, meta, created_at, updated_at)
        VALUES ${sql.join(
          chunk.map(
            (item) => sql`(gen_random_uuid(), ${item.product.id}::uuid, ${item.product.sourceId}::uuid, ARRAY[${item.ingredientId}::uuid], 1.0, 'rule_exact', 'Exact ingredient name match', '{"isFood": true}'::jsonb, NOW(), NOW())`
          ),
          sql`, `
        )}
        ON CONFLICT (product_id, source_id) DO NOTHING;
      `;
      await db.execute(query);
    }
    console.log(`✅ Saved ${exactRuleItems.length} Exact Rule mappings.`);
  }

  // Stage 3: Process AI Queue in Parallel Batches
  console.log(`\n🤖 Starting Parallel AI Verification for ${aiItems.length} SKUs...`);

  // Split AI items into batches of BATCH_SIZE
  const batches: (typeof aiItems)[] = [];
  for (let i = 0; i < aiItems.length; i += CONFIG.BATCH_SIZE) {
    batches.push(aiItems.slice(i, i + CONFIG.BATCH_SIZE));
  }

  let completedBatches = 0;
  let totalMappedFoodSkus = 0;

  async function processBatch(batch: typeof aiItems, batchIndex: number) {
    const payload = batch.map((p) => ({
      productId: p.id,
      productTitle: p.name,
      candidateIngredients: getTopCandidates(p.name, 8),
    }));

    const prompt = `
You are an expert Sri Lankan food & supermarket ingredient matching assistant.
Map each supermarket product to the most relevant canonical ingredient(s) from its "candidateIngredients" list.

Strict Instructions:
1. Return a JSON Array matching the schema.
2. Select ONLY valid candidate ingredient IDs from its list if it represents a food item.
3. If no candidate matches or it's a non-food item, set "matchedIngredientIds": [] and "isFood": false.
4. Set "confidence" between 0.0 and 1.0.

Products Batch:
${JSON.stringify(payload, null, 2)}
`;

    try {
      const response = await ai.models.generateContent({
        model: CONFIG.GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: zodToJsonSchema(batchResultSchema as any),
        },
      });

      if (response.usageMetadata) {
        trackCostAndEnforceBudget(
          response.usageMetadata.promptTokenCount || 0,
          response.usageMetadata.candidatesTokenCount || 0
        );
      }

      if (response.text) {
        const results: z.infer<typeof batchResultSchema> = JSON.parse(response.text);

        const insertRows = [];
        for (const res of results) {
          const orig = batch.find((b) => b.id === res.productId);
          if (!orig) continue;

          const ingArray = res.matchedIngredientIds || [];
          if (ingArray.length > 0) totalMappedFoodSkus++;

          const ingPgArray = ingArray.length > 0 ? sql`ARRAY[${sql.join(ingArray.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]` : sql`ARRAY[]::uuid[]`;

          insertRows.push(
            sql`(gen_random_uuid(), ${orig.id}::uuid, ${orig.sourceId}::uuid, ${ingPgArray}, ${res.confidence || 0.8}, 'ai', ${res.reason || "Gemini 2.5 Flash verification"}, ${JSON.stringify({ isFood: res.isFood })}::jsonb, NOW(), NOW())`
          );
        }

        if (insertRows.length > 0) {
          const query = sql`
            INSERT INTO ${mappings} (id, product_id, source_id, matched_ingredients, confidence, method, notes, meta, created_at, updated_at)
            VALUES ${sql.join(insertRows, sql`, `)}
            ON CONFLICT (product_id, source_id) DO NOTHING;
          `;
          await db.execute(query);
        }

        completedBatches++;
        if (completedBatches % 5 === 0 || completedBatches === batches.length) {
          console.log(` Progress: [${completedBatches}/${batches.length} batches] | Mapped Food SKUs: ${totalMappedFoodSkus} | AI Cost: $${cumulativeCostUSD.toFixed(4)} USD`);
        }
      }
    } catch (err: any) {
      console.error(`⚠️ Batch #${batchIndex} error:`, err.message || err);
      // Wait 1 second before retry if needed
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Worker Pool Execution with Concurrency Limit
  let currentBatchIdx = 0;
  async function worker() {
    while (currentBatchIdx < batches.length) {
      const idx = currentBatchIdx++;
      await processBatch(batches[idx], idx);
    }
  }

  const workers = Array.from({ length: CONFIG.CONCURRENCY }, () => worker());
  await Promise.all(workers);

  console.log("\n==========================================================================================");
  console.log("🎉 ALL INGREDIENT MAPPING BATCHES COMPLETED SUCCESSFULLY!");
  console.log("==========================================================================================");
}

runPipeline()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Pipeline Error:", err);
    process.exit(1);
  });
