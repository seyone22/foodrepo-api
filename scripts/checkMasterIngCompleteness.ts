import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { ingredients } from "@/utils/schema";
import { sql } from "drizzle-orm";

async function checkFinalIngCompleteness() {
  const totalRes = await db.select({ count: sql<number>`count(*)` }).from(ingredients);
  const total = Number(totalRes[0]?.count || 0);

  const stats = await db
    .select({
      name: sql<number>`count(${ingredients.name})`,
      dietaryFlags: sql<number>`count(case when array_length(${ingredients.dietaryFlags}, 1) > 0 then 1 end)`,
      partOf: sql<number>`count(case when array_length(${ingredients.partOf}, 1) > 0 then 1 end)`,
      varieties: sql<number>`count(case when array_length(${ingredients.varieties}, 1) > 0 then 1 end)`,
      derivatives: sql<number>`count(case when array_length(${ingredients.derivatives}, 1) > 0 then 1 end)`,
      usedIn: sql<number>`count(case when array_length(${ingredients.usedIn}, 1) > 0 then 1 end)`,
      substitutes: sql<number>`count(case when array_length(${ingredients.substitutes}, 1) > 0 then 1 end)`,
      fdcId: sql<number>`count(${ingredients.fdcId})`,
      image: sql<number>`count(case when (${ingredients.image}->>'missing')::boolean IS FALSE OR ${ingredients.image}->>'url' IS NOT NULL then 1 end)`,
      aliases: sql<number>`count(case when array_length(${ingredients.aliases}, 1) > 0 then 1 end)`,
      embedding: sql<number>`count(${ingredients.embedding})`,
    })
    .from(ingredients);

  const s = stats[0];
  const pct = (v: number) => `${v} (${((v / total) * 100).toFixed(1)}%)`;

  console.log("=================================================");
  console.log("📊 MASTER INGREDIENTS UPDATED COMPLETENESS METRICS");
  console.log("=================================================");
  console.log(`Total Ingredients: ${total}`);
  console.log(`  ├─ name:          ${pct(Number(s.name))}`);
  console.log(`  ├─ dietaryFlags:  ${pct(Number(s.dietaryFlags))}`);
  console.log(`  ├─ partOf:        ${pct(Number(s.partOf))}`);
  console.log(`  ├─ varieties:     ${pct(Number(s.varieties))}`);
  console.log(`  ├─ derivatives:   ${pct(Number(s.derivatives))}`);
  console.log(`  ├─ usedIn:        ${pct(Number(s.usedIn))}`);
  console.log(`  ├─ substitutes:   ${pct(Number(s.substitutes))}`);
  console.log(`  ├─ fdcId:         ${pct(Number(s.fdcId))}`);
  console.log(`  ├─ image:         ${pct(Number(s.image))}`);
  console.log(`  ├─ aliases:       ${pct(Number(s.aliases))}`);
  console.log(`  └─ embedding:     ${pct(Number(s.embedding))}`);
}

checkFinalIngCompleteness()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
