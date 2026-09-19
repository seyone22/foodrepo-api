import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import {
  priceSources,
  products,
  priceHistories,
  stockHistories,
  mappings,
} from "@/utils/schema";
import { eq, inArray } from "drizzle-orm";

async function mergeSparSources() {
  console.log("🔄 Starting Fast SPAR Source Consolidation...");

  const sources = await db.select().from(priceSources);
  const targetSpar = sources.find((s) => s.name === "SPAR");
  const legacySpar = sources.find((s) => s.name === "Spar");

  if (!targetSpar) {
    throw new Error("Target price source 'SPAR' not found.");
  }
  if (!legacySpar) {
    console.log("✅ No legacy 'Spar' price source found. Already merged!");
    return;
  }

  console.log(`Target SPAR ID: ${targetSpar.id}`);
  console.log(`Legacy Spar ID: ${legacySpar.id}`);

  // Fetch legacy products
  const legacyProducts = await db
    .select()
    .from(products)
    .where(eq(products.sourceId, legacySpar.id));

  console.log(`📦 Found ${legacyProducts.length} products under legacy 'Spar'.`);

  // Fetch target products
  const targetProducts = await db
    .select()
    .from(products)
    .where(eq(products.sourceId, targetSpar.id));

  const targetMapByExtId = new Map<string, typeof products.$inferSelect>();
  const targetMapBySku = new Map<string, typeof products.$inferSelect>();
  const targetMapByName = new Map<string, typeof products.$inferSelect>();

  for (const tp of targetProducts) {
    if (tp.externalId) targetMapByExtId.set(tp.externalId, tp);
    if (tp.sku) targetMapBySku.set(tp.sku, tp);
    if (tp.name) targetMapByName.set(tp.name.toLowerCase().trim(), tp);
  }

  const idsToDelete: string[] = [];
  const idsToUpdateSource: string[] = [];

  for (const lp of legacyProducts) {
    const targetMatch =
      (lp.externalId ? targetMapByExtId.get(lp.externalId) : null) ||
      (lp.sku ? targetMapBySku.get(lp.sku) : null) ||
      targetMapByName.get(lp.name.toLowerCase().trim());

    if (targetMatch) {
      idsToDelete.push(lp.id);
    } else {
      idsToUpdateSource.push(lp.id);
    }
  }

  console.log(`Matching: ${idsToDelete.length} duplicates to delete, ${idsToUpdateSource.length} unique products to transfer.`);

  // Batch update unique products source_id to target SPAR
  if (idsToUpdateSource.length > 0) {
    // Process in batches of 500
    for (let i = 0; i < idsToUpdateSource.length; i += 500) {
      const chunk = idsToUpdateSource.slice(i, i + 500);
      await db
        .update(products)
        .set({ sourceId: targetSpar.id })
        .where(inArray(products.id, chunk));
    }
  }

  // Delete duplicates
  if (idsToDelete.length > 0) {
    for (let i = 0; i < idsToDelete.length; i += 500) {
      const chunk = idsToDelete.slice(i, i + 500);
      // Clean up histories/mappings referencing deleting products
      await db
        .delete(priceHistories)
        .where(inArray(priceHistories.productId, chunk));
      await db
        .delete(stockHistories)
        .where(inArray(stockHistories.productId, chunk));
      await db
        .delete(mappings)
        .where(inArray(mappings.productId, chunk));
      await db
        .delete(products)
        .where(inArray(products.id, chunk));
    }
  }

  // Re-link any remaining mappings attached directly to legacy sourceId
  await db
    .update(mappings)
    .set({ sourceId: targetSpar.id })
    .where(eq(mappings.sourceId, legacySpar.id));

  // Delete the legacy priceSource entry
  await db.delete(priceSources).where(eq(priceSources.id, legacySpar.id));
  console.log(`🎉 Successfully deleted legacy price_source 'Spar' (${legacySpar.id}).`);
}

mergeSparSources()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Merge failed:", err);
    process.exit(1);
  });
