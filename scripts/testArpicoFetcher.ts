import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { ArpicoFetcher } from "@/services/arpicoFetcher";
import { db } from "@/utils/db";
import { products, priceSources } from "@/utils/schema";
import { eq, sql } from "drizzle-orm";

async function testArpico() {
  console.log("🟢 Starting Arpico Supercentre (myarpico.com) Scraper & Persistence...\n");

  const fetcher = new ArpicoFetcher();
  const rawItems = await fetcher.fetchFromSource({ itemsPerPage: 100 });

  console.log(`📦 Fetched ${rawItems.length} raw Arpico products.`);

  if (rawItems.length > 0) {
    const sampleMapped = fetcher.mapToProduct(rawItems[0]);
    console.log("\n==========================================================");
    console.log("📋 MAPPED ARPICO PRODUCT SAMPLE:");
    console.log("==========================================================");
    console.log(JSON.stringify(sampleMapped, null, 2));

    // Save items to PostgreSQL using bulk chunk batching
    const arpicoSrc = await db
      .select({ id: priceSources.id })
      .from(priceSources)
      .where(eq(priceSources.name, "Arpico"))
      .limit(1);

    if (arpicoSrc.length > 0) {
      const sourceId = arpicoSrc[0].id;
      const mappedPayloads = rawItems.map((r) => fetcher.mapToProduct(r));

      // Deduplicate by externalId
      const uniqueMap = new Map<string, typeof products.$inferInsert>();
      for (const item of mappedPayloads) {
        if (item.externalId) {
          uniqueMap.set(item.externalId, item);
        }
      }

      const deduplicated = Array.from(uniqueMap.values());
      console.log(`\n💾 Persisting ${deduplicated.length} Arpico products into PostgreSQL...`);

      const chunkSize = 200;
      for (let i = 0; i < deduplicated.length; i += chunkSize) {
        const chunk = deduplicated.slice(i, i + chunkSize);
        await db
          .insert(products)
          .values(chunk)
          .onConflictDoUpdate({
            target: [products.externalId, products.sourceId],
            set: {
              price: sql`excluded.price`,
              mrp: sql`excluded.mrp`,
              name: sql`excluded.name`,
              url: sql`excluded.url`,
              lastFetched: sql`excluded.last_fetched`,
            },
          });
      }

      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(eq(products.sourceId, sourceId));

      console.log(`\n✅ Persistence Complete! Total Arpico items in DB: ${count[0].count}`);
    }
  }
}

testArpico()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
