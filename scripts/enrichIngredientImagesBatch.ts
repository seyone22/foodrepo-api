import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients, auditLogs } from "../src/utils/schema";
import { sql } from "drizzle-orm";
import { fetchIngredientImage } from "../src/services/imageIngestService";

const DELAY_MS = 350; // polite throttling delay between requests

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOvernightImageEnrichment() {
  console.log("==========================================================================================");
  console.log("🖼️ OVERNIGHT INGREDIENT IMAGE ENRICHMENT PIPELINE");
  console.log("==========================================================================================");

  const limitArg = process.env.MAX_ITEMS ? parseInt(process.env.MAX_ITEMS, 10) : 20000;

  // Query ingredients missing an image
  const rawItems = await db.execute(sql`
    SELECT id, name
    FROM ${ingredients}
    WHERE image IS NULL
       OR (image->>'missing')::boolean = true
       OR image->>'url' IS NULL
       OR image->>'url' = ''
    LIMIT ${limitArg};
  `);

  const missingItems = rawItems as unknown as { id: string; name: string }[];
  console.log(`📦 Found ${missingItems.length} ingredients missing product images.\n`);

  if (missingItems.length === 0) {
    console.log("✨ All ingredients already have verified product images!");
    process.exit(0);
  }

  let successCount = 0;
  let failCount = 0;
  const sourceStats: Record<string, number> = {};

  for (let i = 0; i < missingItems.length; i++) {
    const item = missingItems[i];

    try {
      const res = await fetchIngredientImage(item.name);

      if (res && res.url) {
        await db.execute(sql`
          UPDATE ${ingredients}
          SET image = ${JSON.stringify({
            url: res.url,
            author: res.author,
            source: res.source,
            missing: false,
          })}::jsonb,
          updated_at = NOW()
          WHERE id = ${item.id}::uuid;
        `);

        successCount++;
        sourceStats[res.source] = (sourceStats[res.source] || 0) + 1;
      } else {
        // Mark as missing so we don't re-query endlessly
        await db.execute(sql`
          UPDATE ${ingredients}
          SET image = ${JSON.stringify({
            missing: true,
            source: "none",
            attemptedAt: new Date().toISOString(),
          })}::jsonb,
          updated_at = NOW()
          WHERE id = ${item.id}::uuid;
        `);
        failCount++;
      }
    } catch (err: any) {
      failCount++;
      console.warn(` ⚠️ Error enriching "${item.name}": ${err.message}`);
    }

    if ((i + 1) % 25 === 0 || i === missingItems.length - 1) {
      const pct = (((i + 1) / missingItems.length) * 100).toFixed(1);
      console.log(` 📊 Progress [${i + 1}/${missingItems.length}] (${pct}%): ${successCount} Matched, ${failCount} Exhausted.`);
      console.log(`    Sources breakdown: ${JSON.stringify(sourceStats)}`);
    }

    await sleep(DELAY_MS);
  }

  console.log("\n==========================================================================================");
  console.log(`🎉 OVERNIGHT IMAGE ENRICHMENT COMPLETE!`);
  console.log(` 🏆 Total Processed : ${missingItems.length}`);
  console.log(` ✅ Images Mapped   : ${successCount}`);
  console.log(` ❌ No Match Found  : ${failCount}`);
  console.log(` 📊 Sources         : ${JSON.stringify(sourceStats, null, 2)}`);
  console.log("==========================================================================================");
}

runOvernightImageEnrichment().then(() => process.exit(0)).catch((err) => {
  console.error("❌ Fatal Pipeline Error:", err);
  process.exit(1);
});
