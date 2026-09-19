import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceHistories, stockHistories } from "@/utils/schema";
import { normalizeQuantityUnit } from "@/utils/normalizeQtyUtil";

import { CargillsFetcher } from "@/services/cargillsFetcher";
import { KeellsFetcher } from "@/services/keelsFetcher";
import { SparFetcher } from "@/services/sparFetcher";

interface Store {
  name: string;
  fetcher: any;
}

const STORES: Store[] = [
  { name: "Cargills", fetcher: CargillsFetcher },
  { name: "Keells", fetcher: KeellsFetcher },
  { name: "Spar", fetcher: SparFetcher },
];

async function refreshProductsByTerm(searchTerm: string) {
  console.log(`🔸 Refreshing products for term: "${searchTerm}"`);

  for (const { name, fetcher: FetcherClass } of STORES) {
    const fetcher = new FetcherClass();

    console.log(`\n🔹 Searching in ${name}...`);
    try {
      const rawProducts = await fetcher.fetchFromSource({
        itemsPerPage: 1000,
        ingredientName: searchTerm,
      });

      if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
        console.log(`⚠️ No results from ${name}.`);
        continue;
      }

      console.log(`📦 ${name}: ${rawProducts.length} raw items found.`);

      // Normalize + map
      const mappedProducts = rawProducts.map((raw: any) => {
        // Get the unified data structure from the specific store's fetcher
        const normalized = fetcher.mapToProduct(raw, "");

        // Apply your global quantity/unit normalizer
        const { quantity, unit } = normalizeQuantityUnit(raw);

        return {
          ...normalized,
          quantity: quantity || normalized.quantity,
          unit: unit || normalized.unit,
          sourceId: normalized.sourceId || fetcher.sourceId,
          sku: normalized.itemCode || normalized.sku || null,
          raw: raw, // Native JSONB parsing in Postgres
        };
      });

      let upsertCount = 0;
      let dailyPricePoints = 0;
      let dailyStockPoints = 0;

      // Upsert sequentially and log history
      for (const scraped of mappedProducts) {
        if (!scraped.externalId || !scraped.sourceId) continue;

        // 1. Upsert the core product data
        const [upserted] = await db
          .insert(products)
          .values({
            ...scraped,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [products.externalId, products.sourceId],
            set: { ...scraped, updatedAt: new Date() },
          })
          .returning({ id: products.id });

        upsertCount++;

        // 2. Record Price History
        if (scraped.price !== undefined && scraped.price > 0) {
          await db.insert(priceHistories).values({
            productId: upserted.id,
            price: scraped.price,
            currency: scraped.currency || "LKR",
          });
          dailyPricePoints++;
        }

        // 3. Record Stock History
        if (scraped.stockInHand !== undefined && scraped.stockInHand !== null) {
          await db.insert(stockHistories).values({
            productId: upserted.id,
            stock: scraped.stockInHand,
            averageDailySales: scraped.averageSale,
          });
          dailyStockPoints++;
        }
      }

      console.log(`✅ ${name}: ${upsertCount} products processed.`);
      console.log(`📈 Logged ${dailyPricePoints} daily price history points.`);
      console.log(`📊 Logged ${dailyStockPoints} daily stock history points.`);
    } catch (err: any) {
      console.error(`❌ Error refreshing ${name}:`, err.message);
    }

    // short delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n🔻 Done. Process completed.");
}

// Run directly if executed as a script
if (require.main === module) {
  const term = process.argv[2];
  if (!term) {
    console.error("❌ Please provide a search term. Example:");
    console.error("   npx ts-node scripts/refreshProductByTerm.ts apple");
    process.exit(1);
  }

  refreshProductsByTerm(term)
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Fatal error:", err);
      process.exit(1);
    });
}

export { refreshProductsByTerm };
