import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients } from "../src/utils/schema";
import fs from "fs";
import path from "path";

const UNCOUNTABLE_FOODS = new Set([
  "rice", "flour", "sugar", "salt", "water", "milk", "butter", "cheese",
  "oil", "vinegar", "honey", "meat", "beef", "pork", "mutton", "lamb",
  "chicken", "fish", "bread", "pepper", "turmeric", "garlic", "ginger",
  "mustard", "cinnamon", "cardamom", "clove", "saffron", "yeast", "cornstarch",
  "pasta", "spaghetti", "macaroni", "noodle", "sauce", "syrup", "jam", "jelly",
  "grass", "glass", "cress", "swiss", "hummus", "couscous", "molasses", "citrus",
  "hibiscus", "asparagus", "watercress", "lemongrass", "allspice", "anis", "anise",
  "schnapps", "oats", "grits", "calvados", "chaumes"
]);

const IRREGULAR_PLURALS: Record<string, string> = {
  "tomatoes": "tomato", "potatoes": "potato", "mangoes": "mango", "cherries": "cherry",
  "berries": "berry", "strawberries": "strawberry", "blueberries": "blueberry",
  "raspberries": "raspberry", "blackberries": "blackberry", "cranberries": "cranberry",
  "chillies": "chilli", "chilis": "chili", "chilies": "chili", "chile": "chili",
  "leaves": "leaf", "loaves": "loaf", "halves": "half", "radishes": "radish",
  "peaches": "peach", "spices": "spice", "herbs": "herb", "olives": "olive",
  "onions": "onion", "lemons": "lemon", "limes": "lime", "apples": "apple",
  "oranges": "orange", "bananas": "banana", "pears": "pear", "grapes": "grape",
  "figs": "fig", "dates": "date", "nuts": "nut", "walnuts": "walnut",
  "almonds": "almond", "cashews": "cashew", "peanuts": "peanut", "pistachios": "pistachio",
  "carrots": "carrot", "cucumbers": "cucumber", "zucchinis": "zucchini",
  "courgettes": "courgette", "eggplants": "eggplant", "aubergines": "aubergine",
  "capsicums": "capsicum", "peppers": "pepper", "mushrooms": "mushroom",
  "beans": "bean", "peas": "pea", "lentils": "lentil", "chickpeas": "chickpea",
  "cloves": "clove", "seeds": "seed", "eggs": "egg", "sausages": "sausage"
};

function getSingularForm(word: string): { singular: string; isPluralPattern: boolean } {
  const w = word.toLowerCase().trim();
  if (UNCOUNTABLE_FOODS.has(w)) return { singular: w, isPluralPattern: false };
  if (IRREGULAR_PLURALS[w]) return { singular: IRREGULAR_PLURALS[w], isPluralPattern: true };

  const tokens = w.split(/\s+/);
  const lastToken = tokens[tokens.length - 1];

  if (UNCOUNTABLE_FOODS.has(lastToken)) return { singular: w, isPluralPattern: false };
  if (IRREGULAR_PLURALS[lastToken]) {
    tokens[tokens.length - 1] = IRREGULAR_PLURALS[lastToken];
    return { singular: tokens.join(" "), isPluralPattern: true };
  }

  if (lastToken.endsWith("ies") && lastToken.length > 4) {
    tokens[tokens.length - 1] = lastToken.slice(0, -3) + "y";
    return { singular: tokens.join(" "), isPluralPattern: true };
  }

  if (lastToken.endsWith("es") && (lastToken.endsWith("shes") || lastToken.endsWith("ches") || lastToken.endsWith("xes") || lastToken.endsWith("sses"))) {
    tokens[tokens.length - 1] = lastToken.slice(0, -2);
    return { singular: tokens.join(" "), isPluralPattern: true };
  }

  if (lastToken.endsWith("s") && !lastToken.endsWith("ss") && !lastToken.endsWith("us") && !lastToken.endsWith("is") && lastToken.length > 3) {
    tokens[tokens.length - 1] = lastToken.slice(0, -1);
    return { singular: tokens.join(" "), isPluralPattern: true };
  }

  return { singular: w, isPluralPattern: false };
}

async function analyzeIngredientsOnly() {
  console.log("🚀 Starting Analysis EXCLUSIVELY on ingredients table...\n");

  const ingRows = await db.select({
    id: ingredients.id,
    name: ingredients.name,
    aliases: ingredients.aliases,
    varieties: ingredients.varieties
  }).from(ingredients);

  let primaryNamePluralCount = 0;
  let primaryNameSingularCount = 0;

  let totalAliasTerms = 0;
  let aliasSingularCount = 0;
  let aliasPluralCount = 0;

  const ingredientNameCollisions: Array<{ name: string; id: string }> = [];
  const nameSet = new Set<string>();

  for (const ing of ingRows) {
    const cleanName = ing.name.toLowerCase().trim();
    if (nameSet.has(cleanName)) {
      ingredientNameCollisions.push({ name: cleanName, id: ing.id });
    }
    nameSet.add(cleanName);

    const { singular, isPluralPattern } = getSingularForm(cleanName);
    if (isPluralPattern && cleanName !== singular) {
      primaryNamePluralCount++;
    } else {
      primaryNameSingularCount++;
    }

    if (ing.aliases) {
      for (const alias of ing.aliases) {
        if (!alias) continue;
        totalAliasTerms++;
        const cleanAlias = alias.toLowerCase().trim();
        const res = getSingularForm(cleanAlias);
        if (res.isPluralPattern && cleanAlias !== res.singular) {
          aliasPluralCount++;
        } else {
          aliasSingularCount++;
        }
      }
    }
  }

  const primaryTotal = primaryNameSingularCount + primaryNamePluralCount;
  const primarySingularPct = ((primaryNameSingularCount / primaryTotal) * 100).toFixed(2);
  const primaryPluralPct = ((primaryNamePluralCount / primaryTotal) * 100).toFixed(2);

  const report = {
    totalIngredients: ingRows.length,
    primaryNames: {
      total: primaryTotal,
      singularCount: primaryNameSingularCount,
      pluralCount: primaryNamePluralCount,
      singularPercentage: `${primarySingularPct}%`,
      pluralPercentage: `${primaryPluralPct}%`
    },
    aliases: {
      totalAliasTerms,
      singularCount: aliasSingularCount,
      pluralCount: aliasPluralCount
    },
    collisions: {
      directNameCollisions: ingredientNameCollisions.length,
      collisions: ingredientNameCollisions
    }
  };

  console.log("==================================================");
  console.log("       INGREDIENTS TABLE ONLY ANALYSIS            ");
  console.log("==================================================");
  console.log(`Total Ingredients Records:   ${ingRows.length.toLocaleString()}`);
  console.log(`--------------------------------------------------`);
  console.log(`Primary Names in Singular:   ${primaryNameSingularCount.toLocaleString()} (${primarySingularPct}%)`);
  console.log(`Primary Names in Plural:     ${primaryNamePluralCount.toLocaleString()} (${primaryPluralPct}%)`);
  console.log(`Primary Name Collisions:     ${ingredientNameCollisions.length} direct collisions`);
  console.log(`--------------------------------------------------`);
  console.log(`Total Stored Alias Terms:    ${totalAliasTerms.toLocaleString()}`);
  console.log(`  ├─ Singular Aliases:       ${aliasSingularCount.toLocaleString()}`);
  console.log(`  └─ Plural Aliases:         ${aliasPluralCount.toLocaleString()}`);
  console.log("==================================================\n");

  const outPath = path.join(__dirname, "../ingredients_only_analysis.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
}

analyzeIngredientsOnly()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error running ingredients-only analysis:", err);
    process.exit(1);
  });
