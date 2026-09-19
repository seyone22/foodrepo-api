import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, products, usdaFoods } from "../src/utils/schema";
import fs from "fs";
import path from "path";

// Uncountable / Mass Nouns common in food databases
const UNCOUNTABLE_FOODS = new Set([
  "rice", "flour", "sugar", "salt", "water", "milk", "butter", "cheese",
  "oil", "vinegar", "honey", "meat", "beef", "pork", "mutton", "lamb",
  "chicken", "fish", "bread", "pepper", "turmeric", "garlic", "ginger",
  "mustard", "cinnamon", "cardamom", "clove", "saffron", "yeast", "cornstarch",
  "pasta", "spaghetti", "macaroni", "noodle", "sauce", "syrup", "jam", "jelly"
]);

// Special Irregular Mappings (Plural -> Singular)
const IRREGULAR_PLURALS: Record<string, string> = {
  "tomatoes": "tomato",
  "potatoes": "potato",
  "mangoes": "mango",
  "cherries": "cherry",
  "berries": "berry",
  "strawberries": "strawberry",
  "blueberries": "blueberry",
  "raspberries": "raspberry",
  "blackberries": "blackberry",
  "cranberries": "cranberry",
  "chillies": "chilli",
  "chilis": "chilli",
  "leaves": "leaf",
  "loaves": "loaf",
  "halves": "half",
  "radishes": "radish",
  "peaches": "peach",
  "spices": "spice",
  "herbs": "herb",
  "olives": "olive",
  "onions": "onion",
  "lemons": "lemon",
  "limes": "lime",
  "apples": "apple", "oranges": "orange", "bananas": "banana",
  "pears": "pear", "grapes": "grape", "figs": "fig",
  "dates": "date", "nuts": "nut", "walnuts": "walnut",
  "almonds": "almond", "cashews": "cashew", "peanuts": "peanut",
  "pistachios": "pistachio", "carrots": "carrot", "cucumbers": "cucumber",
  "zucchinis": "zucchini", "courgettes": "courgette", "eggplants": "eggplant",
  "aubergines": "aubergine", "capsicums": "capsicum", "peppers": "pepper",
  "mushrooms": "mushroom", "beans": "bean", "peas": "pea",
  "lentils": "lentil", "chickpeas": "chickpea", "cloves": "clove",
  "seeds": "seed", "eggs": "egg", "sausages": "sausage"
};

function getSingularForm(word: string): { singular: string; isPluralPattern: boolean } {
  const w = word.toLowerCase().trim();
  
  if (UNCOUNTABLE_FOODS.has(w)) {
    return { singular: w, isPluralPattern: false };
  }

  if (IRREGULAR_PLURALS[w]) {
    return { singular: IRREGULAR_PLURALS[w], isPluralPattern: true };
  }

  if (w.endsWith("ies") && w.length > 4) {
    return { singular: w.slice(0, -3) + "y", isPluralPattern: true };
  }
  if (w.endsWith("es") && (w.endsWith("shes") || w.endsWith("ches") || w.endsWith("xes") || w.endsWith("sses"))) {
    return { singular: w.slice(0, -2), isPluralPattern: true };
  }
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is") && w.length > 3) {
    return { singular: w.slice(0, -1), isPluralPattern: true };
  }

  return { singular: w, isPluralPattern: false };
}

interface TermOccurrence {
  term: string;
  source: string;
  id: string;
}

async function runAnalysis() {
  console.log("🚀 Starting Comprehensive Singular/Plural Database Analysis...\n");

  const ingRows = await db.select({
    id: ingredients.id,
    name: ingredients.name,
    aliases: ingredients.aliases,
    varieties: ingredients.varieties
  }).from(ingredients);

  const prodRows = await db.select({
    id: products.id,
    name: products.name,
    searchTerms: products.searchTerms
  }).from(products);

  const usdaRows = await db.select({
    fdcId: usdaFoods.fdcId,
    description: usdaFoods.description
  }).from(usdaFoods);

  console.log(`📊 Data Retrieved:`);
  console.log(`   • Ingredients: ${ingRows.length}`);
  console.log(`   • Products: ${prodRows.length}`);
  console.log(`   • USDA Foods: ${usdaRows.length}\n`);

  const ingredientStats = new Map<string, {
    singularExact: Map<string, number>;
    pluralExact: Map<string, number>;
    occurrences: TermOccurrence[];
  }>();

  function recordTerm(term: string, source: string, id: string) {
    if (!term || term.trim().length < 2) return;
    const clean = term.toLowerCase().trim();
    
    const { singular, isPluralPattern } = getSingularForm(clean);

    if (!ingredientStats.has(singular)) {
      ingredientStats.set(singular, {
        singularExact: new Map(),
        pluralExact: new Map(),
        occurrences: []
      });
    }

    const entry = ingredientStats.get(singular)!;
    entry.occurrences.push({ term: clean, source, id });

    if (isPluralPattern || clean !== singular) {
      entry.pluralExact.set(clean, (entry.pluralExact.get(clean) || 0) + 1);
    } else {
      entry.singularExact.set(clean, (entry.singularExact.get(clean) || 0) + 1);
    }
  }

  for (const ing of ingRows) {
    recordTerm(ing.name, "ingredients.name", ing.id);
    if (ing.aliases) {
      for (const alias of ing.aliases) recordTerm(alias, "ingredients.aliases", ing.id);
    }
    if (ing.varieties) {
      for (const varItem of ing.varieties) recordTerm(varItem, "ingredients.varieties", ing.id);
    }
  }

  for (const prod of prodRows) {
    recordTerm(prod.name, "products.name", prod.id);
    if (prod.searchTerms) {
      for (const st of prod.searchTerms) recordTerm(st, "products.searchTerms", prod.id);
    }
  }

  for (const u of usdaRows) {
    recordTerm(u.description, "usdaFoods.description", String(u.fdcId));
  }

  let totalUniqueBaseKeys = ingredientStats.size;
  let totalSingularOnlyKeys = 0;
  let totalPluralOnlyKeys = 0;
  let totalDualFormKeys = 0;

  const dualFormPairs: Array<{
    baseKey: string;
    singularForms: Array<[string, number]>;
    pluralForms: Array<[string, number]>;
    totalSingularOccurrences: number;
    totalPluralOccurrences: number;
    sources: string[];
  }> = [];

  const ingredientTableRedundancy: Array<{
    baseKey: string;
    singularIngName?: string;
    pluralIngName?: string;
  }> = [];

  const exactIngNamesSingular = new Map<string, string>();
  const exactIngNamesPlural = new Map<string, string>();

  for (const ing of ingRows) {
    const clean = ing.name.toLowerCase().trim();
    const { singular, isPluralPattern } = getSingularForm(clean);
    if (isPluralPattern || clean !== singular) {
      exactIngNamesPlural.set(singular, ing.name);
    } else {
      exactIngNamesSingular.set(singular, ing.name);
    }
  }

  for (const [key, singName] of exactIngNamesSingular.entries()) {
    if (exactIngNamesPlural.has(key)) {
      ingredientTableRedundancy.push({
        baseKey: key,
        singularIngName: singName,
        pluralIngName: exactIngNamesPlural.get(key)
      });
    }
  }

  let globalSingularCount = 0;
  let globalPluralCount = 0;

  for (const [baseKey, entry] of ingredientStats.entries()) {
    const singCount = Array.from(entry.singularExact.values()).reduce((a, b) => a + b, 0);
    const plurCount = Array.from(entry.pluralExact.values()).reduce((a, b) => a + b, 0);

    globalSingularCount += singCount;
    globalPluralCount += plurCount;

    if (singCount > 0 && plurCount > 0) {
      totalDualFormKeys++;
      dualFormPairs.push({
        baseKey,
        singularForms: Array.from(entry.singularExact.entries()),
        pluralForms: Array.from(entry.pluralExact.entries()),
        totalSingularOccurrences: singCount,
        totalPluralOccurrences: plurCount,
        sources: Array.from(new Set(entry.occurrences.map(o => o.source)))
      });
    } else if (singCount > 0) {
      totalSingularOnlyKeys++;
    } else if (plurCount > 0) {
      totalPluralOnlyKeys++;
    }
  }

  dualFormPairs.sort((a, b) => (b.totalSingularOccurrences + b.totalPluralOccurrences) - (a.totalSingularOccurrences + a.totalPluralOccurrences));

  const totalTermsAnalyzed = globalSingularCount + globalPluralCount;
  const singularPrevalencePct = ((globalSingularCount / totalTermsAnalyzed) * 100).toFixed(2);
  const pluralPrevalencePct = ((globalPluralCount / totalTermsAnalyzed) * 100).toFixed(2);
  const dualFormPct = ((totalDualFormKeys / totalUniqueBaseKeys) * 100).toFixed(2);

  const reportData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      counts: {
        totalIngredients: ingRows.length,
        totalProducts: prodRows.length,
        totalUsdaFoods: usdaRows.length,
        totalTermsAnalyzed
      }
    },
    statistics: {
      totalUniqueBaseKeys,
      totalSingularOnlyKeys,
      totalPluralOnlyKeys,
      totalDualFormKeys,
      dualFormPercentage: `${dualFormPct}%`,
      globalCounts: {
        singular: globalSingularCount,
        plural: globalPluralCount,
        singularPrevalence: `${singularPrevalencePct}%`,
        pluralPrevalence: `${pluralPrevalencePct}%`,
        singularToPluralRatio: (globalSingularCount / (globalPluralCount || 1)).toFixed(2)
      }
    },
    ingredientTableRedundancy: {
      collisionCount: ingredientTableRedundancy.length,
      collisions: ingredientTableRedundancy
    },
    topDualFormPairs: dualFormPairs.slice(0, 50)
  };

  console.log("==================================================");
  console.log("           DATABASE ANALYSIS SUMMARY              ");
  console.log("==================================================");
  console.log(`Total Terms Processed:       ${totalTermsAnalyzed.toLocaleString()}`);
  console.log(`Total Unique Base Food Keys: ${totalUniqueBaseKeys.toLocaleString()}`);
  console.log(`--------------------------------------------------`);
  console.log(`Singular Occurrences:        ${globalSingularCount.toLocaleString()} (${singularPrevalencePct}%)`);
  console.log(`Plural Occurrences:          ${globalPluralCount.toLocaleString()} (${pluralPrevalencePct}%)`);
  console.log(`Singular-to-Plural Ratio:    ${reportData.statistics.globalCounts.singularToPluralRatio}`);
  console.log(`--------------------------------------------------`);
  console.log(`Singular-Only Base Keys:     ${totalSingularOnlyKeys.toLocaleString()}`);
  console.log(`Plural-Only Base Keys:       ${totalPluralOnlyKeys.toLocaleString()}`);
  console.log(`Dual-Form Base Keys (Both):  ${totalDualFormKeys.toLocaleString()} (${dualFormPct}%)`);
  console.log(`Ingredient Table Collisions: ${ingredientTableRedundancy.length} direct duplicate pairs`);
  console.log("==================================================\n");

  const outputPath = path.join(__dirname, "../singular_plural_analysis_report.json");
  fs.writeFileSync(outputPath, JSON.stringify(reportData, null, 2));
  console.log(`✅ Full analysis report saved to: ${outputPath}`);
}

runAnalysis()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error running analysis:", err);
    process.exit(1);
  });
