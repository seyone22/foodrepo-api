import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { ingredients } from "@/utils/schema";

interface WikidataMatch {
  ingredientName: string;
  subclassOf?: string[];
  partOf?: string[];
  madeFrom?: string[];
  substitutes?: string[];
}

async function queryWikidataForIngredients(sampleNames: string[]): Promise<Record<string, WikidataMatch>> {
  // Construct SPARQL query for sample ingredients
  const valuesClause = sampleNames.map((n) => `"${n.replace(/"/g, '\\"')}"@en`).join(" ");

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
    LIMIT 500
  `;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "IngredientDatabaseAPI/1.0 (dev-agent@antigravity.ai)",
      },
    });

    if (!res.ok) {
      console.error(`Wikidata HTTP Error: ${res.status} ${res.statusText}`);
      return {};
    }

    const data = await res.json();
    const results: Record<string, WikidataMatch> = {};

    for (const b of data.results.bindings) {
      const name = b.ingredientLabel.value.toLowerCase();
      if (!results[name]) {
        results[name] = { ingredientName: name, subclassOf: [], partOf: [], madeFrom: [], substitutes: [] };
      }

      if (b.subclassLabel?.value && !results[name].subclassOf?.includes(b.subclassLabel.value)) {
        results[name].subclassOf?.push(b.subclassLabel.value);
      }
      if (b.partOfLabel?.value && !results[name].partOf?.includes(b.partOfLabel.value)) {
        results[name].partOf?.push(b.partOfLabel.value);
      }
      if (b.madeFromLabel?.value && !results[name].madeFrom?.includes(b.madeFromLabel.value)) {
        results[name].madeFrom?.push(b.madeFromLabel.value);
      }
      if (b.substituteLabel?.value && !results[name].substitutes?.includes(b.substituteLabel.value)) {
        results[name].substitutes?.push(b.substituteLabel.value);
      }
    }

    return results;
  } catch (err) {
    console.error("Wikidata Fetch Error:", err);
    return {};
  }
}

async function runWikidataTest() {
  console.log("=========================================================================");
  console.log("🌐 WIKIDATA SPARQL OPEN DATA MINING EVALUATION (LAYER 2)");
  console.log("=========================================================================\n");

  // Sample a diverse set of 30 ingredients
  const testItems = [
    "ghee", "tofu", "tamarind", "balsamic vinegar", "mozzarella",
    "coconut oil", "turmeric", "basil", "parmesan", "macaroni",
    "pork belly", "salmon", "cashew", "nutritional yeast", "tahini",
    "sourdough", "seitan", "quinoa", "kimchi", "wasabi",
    "coconut milk", "garlic", "cardamom", "soy sauce", "mustard oil",
    "paneer", "jalapeno", "avocado oil", "matcha", "apple cider vinegar"
  ];

  console.log(`🔎 Testing Wikidata SPARQL fetch for ${testItems.length} sample ingredients...\n`);

  const results = await queryWikidataForIngredients(testItems);

  let matchedCount = 0;

  for (const item of testItems) {
    const m = results[item];
    if (m && (m.subclassOf?.length || m.partOf?.length || m.madeFrom?.length || m.substitutes?.length)) {
      matchedCount++;
      console.log(`✅ [FOUND] "${item}":`);
      if (m.subclassOf?.length) console.log(`   ├─ Subclass Of (P279): ${JSON.stringify(m.subclassOf)}`);
      if (m.partOf?.length) console.log(`   ├─ Part Of (P361):     ${JSON.stringify(m.partOf)}`);
      if (m.madeFrom?.length) console.log(`   ├─ Made From (P186):   ${JSON.stringify(m.madeFrom)}`);
      if (m.substitutes?.length) console.log(`   └─ Substitutes (P460): ${JSON.stringify(m.substitutes)}`);
      console.log("---------------------------------------------------------");
    } else {
      console.log(`❌ [NO MATCH / RAW ONTOLOGY MISSING] "${item}"`);
    }
  }

  console.log("\n=========================================================================");
  console.log("📊 WIKIDATA EVALUATION SUMMARY");
  console.log("=========================================================================");
  console.log(`Matched Items: ${matchedCount} / ${testItems.length} (${((matchedCount / testItems.length) * 100).toFixed(1)}%)`);
}

runWikidataTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
