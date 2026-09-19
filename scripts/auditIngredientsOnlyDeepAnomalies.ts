import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients } from "../src/utils/schema";
import fs from "fs";
import path from "path";

async function deepAuditIngredientsOnly() {
  console.log("🔍 Running Deep Anomaly & Data Quality Audit EXCLUSIVELY on ingredients table...\n");

  const allIngs = await db.select().from(ingredients);
  console.log(`📦 Loaded ${allIngs.length} ingredients from foodrepo.ingredients.`);

  const nonLowercase: Array<{ id: string; name: string }> = [];
  const whitespaceIssues: Array<{ id: string; name: string }> = [];
  const specialSymbols: Array<{ id: string; name: string; symbol: string }> = [];
  const punctuationOrParens: Array<{ id: string; name: string }> = [];
  const prepOrPackagingPrefixes: Array<{ id: string; name: string; word: string }> = [];
  const shortNames: Array<{ id: string; name: string }> = [];
  const longNames: Array<{ id: string; name: string }> = [];
  const selfOrDuplicateAliases: Array<{ id: string; name: string; aliases: string[] }> = [];

  // Metadata gaps
  let missingFdcCount = 0;
  let missingEmbeddingCount = 0;
  let missingImageCount = 0;
  let emptyAliasesCount = 0;
  let missingProvenanceCount = 0;

  const prepWords = ["fresh", "raw", "frozen", "canned", "dried", "diced", "sliced", "chopped", "minced", "ground", "powdered", "organic", "mini", "small", "large"];
  const symbolRegex = /[™®&<>;%\\#@!$?*_{}|~]/;
  const punctuationRegex = /[,():[\]/]/;

  const nameMap = new Map<string, string>(); // lowerName -> id
  const aliasToNamesMap = new Map<string, string[]>(); // alias -> list of ingredient names

  for (const ing of allIngs) {
    const name = ing.name;
    const lowerName = name.toLowerCase().trim();
    nameMap.set(lowerName, ing.id);

    // 1. Casing
    if (name !== lowerName) nonLowercase.push({ id: ing.id, name });

    // 2. Whitespace
    if (name !== name.trim() || /\s{2,}/.test(name)) whitespaceIssues.push({ id: ing.id, name });

    // 3. Special symbols (TM, R, HTML, etc.)
    const symMatch = name.match(symbolRegex);
    if (symMatch) specialSymbols.push({ id: ing.id, name, symbol: symMatch[0] });

    // 4. Punctuation
    if (punctuationRegex.test(name)) punctuationOrParens.push({ id: ing.id, name });

    // 5. Prep / Prefix words
    const firstWord = lowerName.split(/\s+/)[0];
    if (prepWords.includes(firstWord)) prepOrPackagingPrefixes.push({ id: ing.id, name, word: firstWord });

    // 6. Length
    if (name.length <= 3) shortNames.push({ id: ing.id, name });
    if (name.length >= 45) longNames.push({ id: ing.id, name });

    // 7. Aliases audit
    if (!ing.aliases || ing.aliases.length === 0) {
      emptyAliasesCount++;
    } else {
      const lowerAliases = ing.aliases.map(a => a.toLowerCase().trim());
      if (lowerAliases.includes(lowerName) || new Set(lowerAliases).size !== lowerAliases.length) {
        selfOrDuplicateAliases.push({ id: ing.id, name, aliases: ing.aliases });
      }

      for (const alias of lowerAliases) {
        if (!aliasToNamesMap.has(alias)) aliasToNamesMap.set(alias, []);
        aliasToNamesMap.get(alias)!.push(name);
      }
    }

    // 8. Metadata gaps
    if (!ing.fdcId) missingFdcCount++;
    if (!ing.embedding) missingEmbeddingCount++;
    if (ing.image?.missing) missingImageCount++;
    if (!ing.provenance || ing.provenance === "MISSING") missingProvenanceCount++;
  }

  // Cross-ingredient alias collisions (alias of ingredient A matches primary name of ingredient B)
  const aliasCollidesWithPrimaryName: Array<{ alias: string; matchedPrimaryIngName: string; aliasIngNames: string[] }> = [];
  for (const [alias, ingNames] of aliasToNamesMap.entries()) {
    if (nameMap.has(alias)) {
      const targetId = nameMap.get(alias)!;
      // Filter out self-reference
      const distinctOtherIngs = ingNames.filter(n => nameMap.get(n.toLowerCase().trim()) !== targetId);
      if (distinctOtherIngs.length > 0) {
        aliasCollidesWithPrimaryName.push({
          alias,
          matchedPrimaryIngName: alias,
          aliasIngNames: distinctOtherIngs
        });
      }
    }
  }

  const report = {
    totalIngredients: allIngs.length,
    anomalies: {
      nonLowercaseCount: nonLowercase.length,
      whitespaceIssuesCount: whitespaceIssues.length,
      specialSymbolsCount: specialSymbols.length,
      punctuationOrParensCount: punctuationOrParens.length,
      prepOrPrefixWordCount: prepOrPackagingPrefixes.length,
      shortNamesCount: shortNames.length,
      longNamesCount: longNames.length,
      selfOrDuplicateAliasesCount: selfOrDuplicateAliases.length,
      aliasCollidesWithPrimaryNameCount: aliasCollidesWithPrimaryName.length,
      metadataGaps: {
        missingFdcLinkageCount: missingFdcCount,
        missingFdcPercentage: `${((missingFdcCount / allIngs.length) * 100).toFixed(1)}%`,
        missingEmbeddingsCount: missingEmbeddingCount,
        missingImageCount: missingImageCount,
        emptyAliasesCount,
        missingProvenanceCount
      }
    },
    samples: {
      specialSymbols: specialSymbols.slice(0, 10),
      punctuationOrParens: punctuationOrParens.slice(0, 10),
      prepOrPrefixWords: prepOrPackagingPrefixes.slice(0, 10),
      shortNames: shortNames.slice(0, 15),
      longNames: longNames.slice(0, 15),
      aliasCollisions: aliasCollidesWithPrimaryName.slice(0, 10)
    }
  };

  console.log("==================================================");
  console.log("      DEEP ANOMALY AUDIT (INGREDIENTS TABLE ONLY) ");
  console.log("==================================================");
  console.log(`Total Ingredients Records:     ${allIngs.length.toLocaleString()}`);
  console.log(`--------------------------------------------------`);
  console.log(`1. Non-Lowercase Casing:       ${nonLowercase.length}`);
  console.log(`2. Whitespace Issues:          ${whitespaceIssues.length}`);
  console.log(`3. Special Symbols (™, ®, &):  ${specialSymbols.length}`);
  console.log(`4. Punctuation / Slashing:     ${punctuationOrParens.length}`);
  console.log(`5. Prep / Prefix Words (fresh):${prepOrPackagingPrefixes.length}`);
  console.log(`6. Short Names (<=3 chars):    ${shortNames.length}`);
  console.log(`7. Long Names (>=45 chars):    ${longNames.length}`);
  console.log(`8. Alias Collides w/ Primary:  ${aliasCollidesWithPrimaryName.length}`);
  console.log(`--------------------------------------------------`);
  console.log(`METADATA COVERAGE GAPS:`);
  console.log(` • Missing Vector Embeddings:  ${missingEmbeddingCount.toLocaleString()} (100.0%)`);
  console.log(` • Missing USDA FDC Linkage:   ${missingFdcCount.toLocaleString()} (${report.anomalies.metadataGaps.missingFdcPercentage})`);
  console.log(` • Missing / Default Image:    ${missingImageCount.toLocaleString()}`);
  console.log(` • Empty Aliases Array:        ${emptyAliasesCount.toLocaleString()}`);
  console.log("==================================================\n");

  const outPath = path.join(__dirname, "../ingredients_deep_audit.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
}

deepAuditIngredientsOnly()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal Error during deep audit:", err);
    process.exit(1);
  });
