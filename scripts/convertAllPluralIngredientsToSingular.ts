import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, mappings } from "../src/utils/schema";
import { eq } from "drizzle-orm";

const UNCOUNTABLE_FOODS = new Set([
  "rice", "flour", "sugar", "salt", "water", "milk", "butter", "cheese",
  "oil", "vinegar", "honey", "meat", "beef", "pork", "mutton", "lamb",
  "chicken", "fish", "bread", "pepper", "turmeric", "garlic", "ginger",
  "mustard", "cinnamon", "cardamom", "clove", "saffron", "yeast", "cornstarch",
  "pasta", "spaghetti", "macaroni", "noodle", "sauce", "syrup", "jam", "jelly",
  "grass", "glass", "cress", "swiss", "hummus", "couscous", "molasses", "citrus",
  "hibiscus", "asparagus", "watercress", "lemongrass", "allspice", "anis", "anise",
  "schnapps", "oats", "grits", "molasses"
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

  if (UNCOUNTABLE_FOODS.has(lastToken)) {
    return { singular: w, isPluralPattern: false };
  }

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

function mergeArrays(...arrays: (string[] | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const arr of arrays) {
    if (arr) {
      for (const item of arr) {
        if (item && item.trim()) set.add(item.trim());
      }
    }
  }
  return Array.from(set);
}

async function convertAllPluralIngredientsToSingular() {
  console.log("🚀 Starting Full Plural-to-Singular Conversion & Collision Resolution...\n");

  const allIngs = await db.select().from(ingredients);
  console.log(`📦 Loaded ${allIngs.length} ingredients from foodrepo.ingredients.`);

  const nameMap = new Map<string, typeof ingredients.$inferSelect>();
  for (const ing of allIngs) {
    nameMap.set(ing.name.toLowerCase().trim(), ing);
  }

  const pluralIngsToConvert: Array<{
    ing: typeof ingredients.$inferSelect;
    singularName: string;
  }> = [];

  for (const ing of allIngs) {
    const clean = ing.name.toLowerCase().trim();
    const { singular, isPluralPattern } = getSingularForm(clean);

    if (isPluralPattern && singular !== clean) {
      pluralIngsToConvert.push({ ing, singularName: singular });
    }
  }

  console.log(`⚡ Found ${pluralIngsToConvert.length} primary ingredient names in PLURAL form to convert to singular.\n`);

  let convertedInPlaceCount = 0;
  let mergedCollisionsCount = 0;
  let reLinkedMappingsCount = 0;

  for (const item of pluralIngsToConvert) {
    const { ing, singularName } = item;
    const existingSingular = nameMap.get(singularName);

    if (existingSingular && existingSingular.id !== ing.id) {
      console.log(`⚡ COLLISION: Merging plural "${ing.name}" (ID: ${ing.id}) ➔ singular "${existingSingular.name}" (ID: ${existingSingular.id})`);

      const combinedAliases = mergeArrays(existingSingular.aliases, ing.aliases, [ing.name]);
      const combinedVarieties = mergeArrays(existingSingular.varieties, ing.varieties);
      const combinedUsedIn = mergeArrays(existingSingular.usedIn, ing.usedIn);
      const combinedSubstitutes = mergeArrays(existingSingular.substitutes, ing.substitutes);

      await db.update(ingredients)
        .set({
          aliases: combinedAliases,
          varieties: combinedVarieties,
          usedIn: combinedUsedIn,
          substitutes: combinedSubstitutes,
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, existingSingular.id));

      const relatedMappings = await db.select({
        id: mappings.id,
        matchedIngredients: mappings.matchedIngredients
      }).from(mappings);

      for (const m of relatedMappings) {
        if (m.matchedIngredients && m.matchedIngredients.includes(ing.id)) {
          const newMatched = mergeArrays(
            m.matchedIngredients.map(id => id === ing.id ? existingSingular.id : id)
          );
          await db.update(mappings)
            .set({ matchedIngredients: newMatched })
            .where(eq(mappings.id, m.id));
          reLinkedMappingsCount++;
        }
      }

      await db.delete(ingredients).where(eq(ingredients.id, ing.id));
      mergedCollisionsCount++;
    } else {
      console.log(`🔄 CONVERTING: "${ing.name}" ➔ "${singularName}" (Added "${ing.name}" to aliases)`);

      const newAliases = mergeArrays(ing.aliases, [ing.name]);

      await db.update(ingredients)
        .set({
          name: singularName,
          aliases: newAliases,
          lastModified: new Date(),
          updatedAt: new Date()
        })
        .where(eq(ingredients.id, ing.id));

      nameMap.set(singularName, { ...ing, name: singularName });
      convertedInPlaceCount++;
    }
  }

  console.log("\n==================================================");
  console.log("    PLURAL-TO-SINGULAR CONVERSION COMPLETE        ");
  console.log("==================================================");
  console.log(`Plural Ingredients Evaluated:  ${pluralIngsToConvert.length}`);
  console.log(`Converted to Singular In-Place:${convertedInPlaceCount}`);
  console.log(`Merged Duplicate Collisions:   ${mergedCollisionsCount}`);
  console.log(`Product Mappings Re-linked:    ${reLinkedMappingsCount}`);
  console.log("==================================================\n");
}

convertAllPluralIngredientsToSingular()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error converting plurals to singulars:", err);
    process.exit(1);
  });
