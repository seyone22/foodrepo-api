import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { ingredients } from "@/utils/schema";
import { sql } from "drizzle-orm";

// ----------------------------------------------------------------------
// DETERMINISTIC DERIVATIVE MAP (Base Product -> Derived Products)
// ----------------------------------------------------------------------
const DERIVATIVE_MAP: Record<string, string[]> = {
  milk: ["cheese", "butter", "cream", "yogurt", "whey", "paneer", "ghee", "sour cream", "cream cheese", "ice cream", "condensed milk"],
  grape: ["wine", "raisin", "grape juice", "balsamic vinegar"],
  soybean: ["tofu", "soy sauce", "soy milk", "tempeh", "miso", "edamame"],
  cacao: ["cocoa powder", "cocoa butter", "dark chocolate", "milk chocolate"],
  wheat: ["wheat flour", "semolina", "pasta", "couscous", "seitan", "wheat bran"],
  sugarcane: ["sugar", "molasses", "rum", "brown sugar"],
  apple: ["apple cider", "apple juice", "apple cider vinegar", "applesauce"],
  coconut: ["coconut oil", "coconut milk", "coconut cream", "coconut water", "coconut flour", "coconut sugar"],
  corn: ["corn starch", "corn syrup", "corn oil", "cornmeal", "popcorn"],
  rice: ["rice flour", "rice milk", "rice vinegar", "sake", "rice paper"],
  peanut: ["peanut butter", "peanut oil"],
  olive: ["olive oil", "extra virgin olive oil"],
  mustard: ["mustard oil", "mustard paste", "dijon mustard"],
  sesame: ["sesame oil", "tahini", "sesame seed"],
  tomato: ["tomato paste", "tomato sauce", "ketchup", "sun-dried tomato"],
};

async function runLayer1SelfGraphing() {
  const startTime = Date.now();
  console.log("=========================================================================");
  console.log("🚀 LAYER 1: DETERMINISTIC KNOWLEDGE GRAPH SELF-GRAPHING ENGINE");
  console.log("=========================================================================\n");

  console.log("📥 Loading master ingredients dataset...");
  const rows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      partOf: ingredients.partOf,
      varieties: ingredients.varieties,
      derivatives: ingredients.derivatives,
    })
    .from(ingredients);

  console.log(`📦 Loaded ${rows.length} master ingredients.\n`);

  // Map for fast name lookups
  const nameToId = new Map<string, string>();
  const nameSet = new Set<string>();

  for (const r of rows) {
    const clean = r.name.toLowerCase().trim();
    nameToId.set(clean, r.id);
    nameSet.add(clean);
  }

  // Graph Accumulators: ID -> Set of names
  const partOfGraph = new Map<string, Set<string>>();
  const varietiesGraph = new Map<string, Set<string>>();
  const derivativesGraph = new Map<string, Set<string>>();

  // Initialize accumulators
  for (const r of rows) {
    partOfGraph.set(r.id, new Set(r.partOf || []));
    varietiesGraph.set(r.id, new Set(r.varieties || []));
    derivativesGraph.set(r.id, new Set(r.derivatives || []));
  }

  console.log("⚡ Inferring partOf <-> varieties reciprocal relationships...");
  let partOfEdgesCount = 0;

  for (const r of rows) {
    const cleanName = r.name.toLowerCase().trim();
    const tokens = cleanName.split(/\s+/);

    if (tokens.length > 1) {
      // Check last token (e.g. "gala apple" -> "apple")
      const lastWord = tokens[tokens.length - 1];
      if (nameSet.has(lastWord) && lastWord !== cleanName) {
        const parentId = nameToId.get(lastWord);
        if (parentId) {
          // Child gets partOf = parent
          partOfGraph.get(r.id)?.add(lastWord);
          // Parent gets varieties = child
          varietiesGraph.get(parentId)?.add(cleanName);
          partOfEdgesCount++;
        }
      }

      // Check last two tokens if length > 2 (e.g. "extra virgin olive oil" -> "olive oil")
      if (tokens.length > 2) {
        const lastTwoWords = tokens.slice(-2).join(" ");
        if (nameSet.has(lastTwoWords) && lastTwoWords !== cleanName) {
          const parentId = nameToId.get(lastTwoWords);
          if (parentId) {
            partOfGraph.get(r.id)?.add(lastTwoWords);
            varietiesGraph.get(parentId)?.add(cleanName);
            partOfEdgesCount++;
          }
        }
      }
    }
  }

  console.log(`✅ Discovered ${partOfEdgesCount} partOf <-> varieties edges.`);

  console.log("⚡ Applying deterministic derivatives map...");
  let derivativeEdgesCount = 0;

  for (const [baseKey, derivedList] of Object.entries(DERIVATIVE_MAP)) {
    const baseId = nameToId.get(baseKey);
    if (baseId) {
      for (const d of derivedList) {
        if (nameSet.has(d)) {
          derivativesGraph.get(baseId)?.add(d);
          // Reciprocal: derived item is partOf / derivative of base
          const derivedId = nameToId.get(d);
          if (derivedId) {
            partOfGraph.get(derivedId)?.add(baseKey);
          }
          derivativeEdgesCount++;
        }
      }
    }
  }

  console.log(`✅ Discovered ${derivativeEdgesCount} derivatives edges.`);

  // Prepare batch updates
  console.log("\n💾 Updating Postgres database with graph relations...");

  const updates: { id: string; partOf: string[]; varieties: string[]; derivatives: string[] }[] = [];
  let itemsToUpdateCount = 0;

  for (const r of rows) {
    const pList = Array.from(partOfGraph.get(r.id) || []);
    const vList = Array.from(varietiesGraph.get(r.id) || []);
    const dList = Array.from(derivativesGraph.get(r.id) || []);

    if (pList.length > 0 || vList.length > 0 || dList.length > 0) {
      updates.push({
        id: r.id,
        partOf: pList,
        varieties: vList,
        derivatives: dList,
      });
      itemsToUpdateCount++;
    }
  }

  console.log(`📦 Updating ${itemsToUpdateCount} ingredient nodes in database...`);

  const BATCH_SIZE = 1000;
  let batch: typeof updates = [];
  let processed = 0;

  for (const item of updates) {
    batch.push(item);
    processed++;

    if (batch.length >= BATCH_SIZE || processed === updates.length) {
      const partOfCases = batch
        .map((u) => `WHEN id = '${u.id}'::uuid THEN ARRAY[${u.partOf.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`)
        .join(" ");

      const varietiesCases = batch
        .map((u) => `WHEN id = '${u.id}'::uuid THEN ARRAY[${u.varieties.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`)
        .join(" ");

      const derivativesCases = batch
        .map((u) => `WHEN id = '${u.id}'::uuid THEN ARRAY[${u.derivatives.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`)
        .join(" ");

      const idsList = batch.map((u) => `'${u.id}'::uuid`).join(",");

      const query = sql.raw(
        `UPDATE foodrepo.ingredients 
         SET part_of = CASE ${partOfCases} END,
             varieties = CASE ${varietiesCases} END,
             derivatives = CASE ${derivativesCases} END,
             last_modified = NOW()
         WHERE id IN (${idsList})`
      );

      await db.execute(query);
      console.log(`  └─ Updated ${processed}/${updates.length} nodes (${((processed / updates.length) * 100).toFixed(1)}%)...`);
      batch = [];
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n=========================================================================");
  console.log("🎉 LAYER 1 KNOWLEDGE GRAPH POPULATION COMPLETED!");
  console.log("=========================================================================");
  console.log(`⏱️ Execution Time: ${durationSec} seconds`);
  console.log(`🕸️ Total Updated Nodes: ${itemsToUpdateCount} / ${rows.length} (${((itemsToUpdateCount / rows.length) * 100).toFixed(1)}%)`);
  console.log(`  ├─ partOf edges created:       ${partOfEdgesCount}`);
  console.log(`  ├─ varieties edges created:    ${partOfEdgesCount}`);
  console.log(`  └─ derivatives edges created:  ${derivativeEdgesCount}\n`);
}

runLayer1SelfGraphing()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Execution Error:", err);
    process.exit(1);
  });
