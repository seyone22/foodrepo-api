import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients } from "../src/utils/schema";
import fs from "fs";
import path from "path";

async function runAnomalyAudit() {
  console.log("🔍 Running Updated Comprehensive Anomaly Audit on Ingredients...\n");

  const allIngs = await db.select().from(ingredients);
  console.log(`📦 Fetched ${allIngs.length} ingredients from foodrepo.ingredients.\n`);

  const uppercaseOrMixedCase: Array<{ id: string; name: string }> = [];
  const whitespaceIssues: Array<{ id: string; name: string }> = [];
  const htmlOrSpecialChars: Array<{ id: string; name: string }> = [];
  const quantitiesOrUnits: Array<{ id: string; name: string }> = [];
  const packagingOrPrepWords: Array<{ id: string; name: string }> = [];
  const hyphenOrSpaceVariants: Map<string, string[]> = new Map();
  const missingVectors: string[] = [];
  const missingProvenance: string[] = [];
  const missingFdc: string[] = [];
  const suspiciousShortNames: Array<{ id: string; name: string }> = [];
  const suspiciousLongNames: Array<{ id: string; name: string }> = [];
  const punctuationInNames: Array<{ id: string; name: string }> = [];
  const duplicateAliasesOrSelfAlias: Array<{ id: string; name: string; aliases: string[] }> = [];

  const prepWords = ["fresh", "raw", "frozen", "canned", "dried", "diced", "sliced", "chopped", "minced", "ground", "powdered", "organic", "pack", "bag", "bottle", "can", "jar", "box", "brand"];
  const quantityRegex = /\b(\d+|\d+g|\d+kg|\d+oz|\d+ml|\d+lb|\d+%\s*fat|\d+%\s*milk)\b/i;
  const specialCharRegex = /[&<>;%\\#@!$?*_{}|~]/;
  const punctuationRegex = /[,():[\]/]/;

  for (const ing of allIngs) {
    const name = ing.name;

    // 1. Casing
    if (name !== name.toLowerCase()) {
      uppercaseOrMixedCase.push({ id: ing.id, name });
    }

    // 2. Whitespace
    if (name !== name.trim() || /\s{2,}/.test(name)) {
      whitespaceIssues.push({ id: ing.id, name });
    }

    // 3. HTML / Special Characters
    if (specialCharRegex.test(name) || name.includes("&amp;") || name.includes("&#")) {
      htmlOrSpecialChars.push({ id: ing.id, name });
    }

    // 4. Quantities / Pack sizes (excluding percentage milks like milk 2%)
    if (quantityRegex.test(name) && !name.toLowerCase().startsWith("milk ")) {
      quantitiesOrUnits.push({ id: ing.id, name });
    }

    // 5. Packaging / Preparation words
    const lower = name.toLowerCase();
    const tokens = lower.split(/\s+/);
    if (tokens.some(t => prepWords.includes(t))) {
      packagingOrPrepWords.push({ id: ing.id, name });
    }

    // 6. Hyphen vs Space
    const dehyphenated = lower.replace(/-/g, " ");
    if (!hyphenOrSpaceVariants.has(dehyphenated)) {
      hyphenOrSpaceVariants.set(dehyphenated, []);
    }
    hyphenOrSpaceVariants.get(dehyphenated)!.push(name);

    // 7. Missing metadata
    if (!ing.embedding) missingVectors.push(ing.name);
    if (!ing.provenance || ing.provenance === "MISSING") missingProvenance.push(ing.name);
    if (!ing.fdcId) missingFdc.push(ing.name);

    // 8. Length anomalies
    if (name.length <= 2) suspiciousShortNames.push({ id: ing.id, name });
    if (name.length >= 60) suspiciousLongNames.push({ id: ing.id, name });

    // 9. Punctuation in names (commas, parentheses, brackets, colons, slashes)
    if (punctuationRegex.test(name)) {
      punctuationInNames.push({ id: ing.id, name });
    }

    // 10. Self-referential or duplicate aliases
    if (ing.aliases && ing.aliases.length > 0) {
      const lowerAliases = ing.aliases.map(a => a.toLowerCase().trim());
      if (lowerAliases.includes(lower) || new Set(lowerAliases).size !== lowerAliases.length) {
        duplicateAliasesOrSelfAlias.push({ id: ing.id, name, aliases: ing.aliases });
      }
    }
  }

  const hyphenCollisions: Array<{ base: string; variants: string[] }> = [];
  for (const [base, variants] of hyphenOrSpaceVariants.entries()) {
    if (variants.length > 1 && new Set(variants).size > 1) {
      hyphenCollisions.push({ base, variants });
    }
  }

  const summary = {
    totalIngredients: allIngs.length,
    anomalies: {
      garbageOrShortCount: suspiciousShortNames.length,
      htmlOrSpecialCharsCount: htmlOrSpecialChars.length,
      concatenatedLongCount: suspiciousLongNames.length,
      quantitiesOrUnitsInNameCount: quantitiesOrUnits.length,
      hyphenVsSpaceDuplicatesCount: hyphenCollisions.length,
      uppercaseOrTitleCaseCount: uppercaseOrMixedCase.length,
      whitespaceIssuesCount: whitespaceIssues.length,
      punctuationInNamesCount: punctuationInNames.length,
      duplicateOrSelfAliasesCount: duplicateAliasesOrSelfAlias.length,
      packagingOrPrepWordsInNameCount: packagingOrPrepWords.length,
      missingVectorsCount: missingVectors.length,
      missingUsdaFdcLinkCount: missingFdc.length
    },
    samples: {
      punctuationInNames: punctuationInNames.slice(0, 15),
      duplicateOrSelfAliases: duplicateAliasesOrSelfAlias.slice(0, 10),
      uppercaseOrTitleCase: uppercaseOrMixedCase.slice(0, 10),
      hyphenVsSpaceCollisions: hyphenCollisions,
      shortNames: suspiciousShortNames,
      longNames: suspiciousLongNames
    }
  };

  console.log("==================================================");
  console.log(`        UPDATED INGREDIENT ANOMALY PROFILE (${allIngs.length.toLocaleString()} Items)`);
  console.log("==================================================");
  console.log(`1. Garbage / Single-Char Entries:       ${summary.anomalies.garbageOrShortCount}`);
  console.log(`2. Scraped Brand & Recipe Slugs:        ${summary.anomalies.htmlOrSpecialCharsCount}`);
  console.log(`3. Concatenated Multi-Ingredient Names: ${summary.anomalies.concatenatedLongCount}`);
  console.log(`4. Embedded Pack Weights/Units:         ${summary.anomalies.quantitiesOrUnitsInNameCount}`);
  console.log(`5. Hyphen vs Space Duplicate Pairs:     ${summary.anomalies.hyphenVsSpaceDuplicatesCount}`);
  console.log(`6. Inconsistent Casing (Title/Upper):   ${summary.anomalies.uppercaseOrTitleCaseCount}`);
  console.log(`7. Leading / Trailing Whitespace:       ${summary.anomalies.whitespaceIssuesCount}`);
  console.log(`8. Punctuation in Names (commas/slashes):${summary.anomalies.punctuationInNamesCount}`);
  console.log(`9. Duplicate/Self-Referential Aliases:  ${summary.anomalies.duplicateOrSelfAliasesCount}`);
  console.log(`10. Packaging / Prep Prefix Words:      ${summary.anomalies.packagingOrPrepWordsInNameCount}`);
  console.log(`--------------------------------------------------`);
  console.log(`11. Missing Vector Embeddings:          ${summary.anomalies.missingVectorsCount.toLocaleString()}`);
  console.log(`12. Missing USDA FDC Linkage:           ${summary.anomalies.missingUsdaFdcLinkCount.toLocaleString()}`);
  console.log("==================================================\n");

  const outPath = path.join(__dirname, "../updated_ingredient_anomalies.json");
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
}

runAnomalyAudit()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error running updated anomaly audit:", err);
    process.exit(1);
  });
