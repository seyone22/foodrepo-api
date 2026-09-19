import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { ingredients } from "@/utils/schema";

async function analyzeGraphCandidates() {
  console.log("=================================================");
  console.log("🕸️ DETERMINISTIC KNOWLEDGE GRAPH CANDIDATE ANALYSIS");
  console.log("=================================================\n");

  const rows = await db.select({ name: ingredients.name }).from(ingredients);
  const nameSet = new Set(rows.map((r) => r.name.toLowerCase()));
  const allNames = Array.from(nameSet);

  console.log(`Total Master Ingredients: ${allNames.length}`);

  // Base noun candidates (single word or common bases)
  let partOfMatches = 0;
  const samplePartOf: { child: string; parent: string }[] = [];

  for (const name of allNames) {
    const tokens = name.split(" ");
    if (tokens.length > 1) {
      // Check last word (e.g. "gala apple" -> "apple", "cheddar cheese" -> "cheese")
      const lastWord = tokens[tokens.length - 1];
      if (nameSet.has(lastWord) && lastWord !== name) {
        partOfMatches++;
        if (samplePartOf.length < 15) {
          samplePartOf.push({ child: name, parent: lastWord });
        }
      }
    }
  }

  console.log(`\n🔍 Found ${partOfMatches} deterministic partOf/varieties relationships!`);
  console.log("\nSample Deterministic Subtype -> Parent Inferences:");
  for (const s of samplePartOf) {
    console.log(`  • "${s.child}" ──partOf──> "${s.parent}" (Reciprocal: "${s.parent}" ──variety──> "${s.child}")`);
  }
}

analyzeGraphCandidates()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
