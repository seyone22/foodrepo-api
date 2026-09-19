import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { ingredients } from "@/utils/schema";
import { sql } from "drizzle-orm";

interface WikidataBindings {
  ingredientLabel: { value: string };
  subclassLabel?: { value: string };
  partOfLabel?: { value: string };
  madeFromLabel?: { value: string };
  substituteLabel?: { value: string };
}

async function fetchWikidataBatch(namesBatch: string[]): Promise<WikidataBindings[]> {
  const valuesClause = namesBatch.map((n) => `"${n.replace(/"/g, '\\"')}"@en`).join(" ");

  const sparqlQuery = `
    SELECT ?ingredientLabel ?subclassLabel ?partOfLabel ?madeFromLabel ?substituteLabel WHERE {
      VALUES ?ingredientLabel { ${valuesClause} }
      
      ?item rdfs:label ?ingredientLabel .
      
      OPTIONAL {
        ?item wdt:P279 ?subclass .
        ?subclass rdfs:label ?subclassLabel .
        FILTER(LANG(?subclassLabel) = "en")
      }
      OPTIONAL {
        ?item wdt:P361 ?partOf .
        ?partOf rdfs:label ?partOfLabel .
        FILTER(LANG(?partOfLabel) = "en")
      }
      OPTIONAL {
        ?item wdt:P186 ?madeFrom .
        ?madeFrom rdfs:label ?madeFromLabel .
        FILTER(LANG(?madeFromLabel) = "en")
      }
      OPTIONAL {
        ?item wdt:P460 ?substitute .
        ?substitute rdfs:label ?substituteLabel .
        FILTER(LANG(?substituteLabel) = "en")
      }
      
      FILTER(LANG(?ingredientLabel) = "en")
    }
    LIMIT 2000
  `;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "IngredientDatabaseAPI/1.0 (contact@antigravity.ai)",
      },
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    return data.results?.bindings || [];
  } catch (err) {
    return [];
  }
}

async function runWikidataHarvester() {
  const startTime = Date.now();
  console.log("=========================================================================");
  console.log("🌐 LAYER 2: WIKIDATA SPARQL ONTOLOGY HARVESTER");
  console.log("=========================================================================\n");

  console.log("📥 Loading master ingredients dataset...");
  const rows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      partOf: ingredients.partOf,
      varieties: ingredients.varieties,
      derivatives: ingredients.derivatives,
      usedIn: ingredients.usedIn,
      substitutes: ingredients.substitutes,
    })
    .from(ingredients);

  console.log(`📦 Loaded ${rows.length} master ingredients.\n`);

  const nameToId = new Map<string, string>();
  const nameSet = new Set<string>();

  for (const r of rows) {
    const clean = r.name.toLowerCase().trim();
    nameToId.set(clean, r.id);
    nameSet.add(clean);
  }

  // Accumulators
  const partOfGraph = new Map<string, Set<string>>();
  const varietiesGraph = new Map<string, Set<string>>();
  const derivativesGraph = new Map<string, Set<string>>();
  const usedInGraph = new Map<string, Set<string>>();
  const substitutesGraph = new Map<string, Set<string>>();

  for (const r of rows) {
    partOfGraph.set(r.id, new Set(r.partOf || []));
    varietiesGraph.set(r.id, new Set(r.varieties || []));
    derivativesGraph.set(r.id, new Set(r.derivatives || []));
    usedInGraph.set(r.id, new Set(r.usedIn || []));
    substitutesGraph.set(r.id, new Set(r.substitutes || []));
  }

  const allNames = Array.from(nameSet);
  const QUERY_BATCH_SIZE = 50;
  let totalMatchesFound = 0;
  let partOfEdgesAdded = 0;
  let derivativesEdgesAdded = 0;
  let usedInEdgesAdded = 0;
  let substitutesEdgesAdded = 0;

  console.log(`⚡ Querying Wikidata SPARQL in batches of ${QUERY_BATCH_SIZE}...`);

  for (let i = 0; i < allNames.length; i += QUERY_BATCH_SIZE) {
    const batch = allNames.slice(i, i + QUERY_BATCH_SIZE);
    const bindings = await fetchWikidataBatch(batch);

    if (bindings.length > 0) {
      for (const b of bindings) {
        const ingName = b.ingredientLabel.value.toLowerCase().trim();
        const ingId = nameToId.get(ingName);

        if (!ingId) continue;

        // 1. Subclass Of (P279) -> partOf / varieties
        if (b.subclassLabel?.value) {
          const subName = b.subclassLabel.value.toLowerCase().trim();
          if (nameSet.has(subName) && subName !== ingName) {
            partOfGraph.get(ingId)?.add(subName);
            const parentId = nameToId.get(subName);
            if (parentId) varietiesGraph.get(parentId)?.add(ingName);
            partOfEdgesAdded++;
            totalMatchesFound++;
          }
        }

        // 2. Part Of (P361) -> usedIn
        if (b.partOfLabel?.value) {
          const pName = b.partOfLabel.value.toLowerCase().trim();
          usedInGraph.get(ingId)?.add(pName);
          usedInEdgesAdded++;
          totalMatchesFound++;
        }

        // 3. Made From (P186) -> partOf & derivatives
        if (b.madeFromLabel?.value) {
          const rawMaterial = b.madeFromLabel.value.toLowerCase().trim();
          if (nameSet.has(rawMaterial) && rawMaterial !== ingName) {
            partOfGraph.get(ingId)?.add(rawMaterial);
            const rawId = nameToId.get(rawMaterial);
            if (rawId) derivativesGraph.get(rawId)?.add(ingName);
            derivativesEdgesAdded++;
            totalMatchesFound++;
          }
        }

        // 4. Substitutes (P460) -> substitutes
        if (b.substituteLabel?.value) {
          const subItem = b.substituteLabel.value.toLowerCase().trim();
          if (nameSet.has(subItem) && subItem !== ingName) {
            substitutesGraph.get(ingId)?.add(subItem);
            substitutesEdgesAdded++;
            totalMatchesFound++;
          }
        }
      }
    }

    if ((i + QUERY_BATCH_SIZE) % 500 === 0 || i + QUERY_BATCH_SIZE >= allNames.length) {
      const progress = Math.min(i + QUERY_BATCH_SIZE, allNames.length);
      console.log(`  └─ Querying progress: ${progress}/${allNames.length} (${((progress / allNames.length) * 100).toFixed(1)}%)...`);
    }

    // Rate-limit throttle (200ms delay between SPARQL requests)
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log("\n💾 Updating Postgres database with Wikidata graph relations...");

  const updates: {
    id: string;
    partOf: string[];
    varieties: string[];
    derivatives: string[];
    usedIn: string[];
    substitutes: string[];
  }[] = [];

  for (const r of rows) {
    const pList = Array.from(partOfGraph.get(r.id) || []);
    const vList = Array.from(varietiesGraph.get(r.id) || []);
    const dList = Array.from(derivativesGraph.get(r.id) || []);
    const uList = Array.from(usedInGraph.get(r.id) || []);
    const sList = Array.from(substitutesGraph.get(r.id) || []);

    if (pList.length > 0 || vList.length > 0 || dList.length > 0 || uList.length > 0 || sList.length > 0) {
      updates.push({
        id: r.id,
        partOf: pList,
        varieties: vList,
        derivatives: dList,
        usedIn: uList,
        substitutes: sList,
      });
    }
  }

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

      const usedInCases = batch
        .map((u) => `WHEN id = '${u.id}'::uuid THEN ARRAY[${u.usedIn.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`)
        .join(" ");

      const substitutesCases = batch
        .map((u) => `WHEN id = '${u.id}'::uuid THEN ARRAY[${u.substitutes.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`)
        .join(" ");

      const idsList = batch.map((u) => `'${u.id}'::uuid`).join(",");

      const query = sql.raw(
        `UPDATE foodrepo.ingredients 
         SET part_of = CASE ${partOfCases} END,
             varieties = CASE ${varietiesCases} END,
             derivatives = CASE ${derivativesCases} END,
             used_in = CASE ${usedInCases} END,
             substitutes = CASE ${substitutesCases} END,
             last_modified = NOW()
         WHERE id IN (${idsList})`
      );

      await db.execute(query);
      console.log(`  └─ DB Updated ${processed}/${updates.length} nodes...`);
      batch = [];
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n=========================================================================");
  console.log("🎉 LAYER 2 WIKIDATA HARVESTING COMPLETED!");
  console.log("=========================================================================");
  console.log(`⏱️ Execution Time: ${durationSec} seconds`);
  console.log(`🌐 Total Wikidata Graph Triplets Harvested: ${totalMatchesFound}`);
  console.log(`  ├─ partOf edges added:        ${partOfEdgesAdded}`);
  console.log(`  ├─ derivatives edges added:   ${derivativesEdgesAdded}`);
  console.log(`  ├─ usedIn edges added:        ${usedInEdgesAdded}`);
  console.log(`  └─ substitutes edges added:   ${substitutesEdgesAdded}\n`);
}

runWikidataHarvester()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Harvester Error:", err);
    process.exit(1);
  });
