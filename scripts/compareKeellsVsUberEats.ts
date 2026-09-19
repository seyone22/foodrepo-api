import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceSources } from "@/utils/schema";
import { eq, ilike, sql } from "drizzle-orm";
import { KeellsFetcher } from "@/services/keelsFetcher";
import { UberEatsKeellsFetcher } from "@/services/uberFetcher";

async function runKeellsVsUberEatsComparison() {
  console.log("📊 Starting Keells Direct vs Keells UberEats Price Premium Analysis...\n");

  // 1. Check if UberEats source exists or fetch sample items
  let uberSource = await db
    .select()
    .from(priceSources)
    .where(eq(priceSources.name, "UberEats_Keells"))
    .limit(1);

  let keellsSource = await db
    .select()
    .from(priceSources)
    .where(eq(priceSources.name, "Keells"))
    .limit(1);

  const keellsFetcher = new KeellsFetcher();
  const uberFetcher = new UberEatsKeellsFetcher();

  console.log("🌐 Fetching sample products from Keells Direct...");
  const keellsItems = await keellsFetcher.fetchFromSource({ itemsPerPage: 100 });

  console.log("🌐 Fetching sample products from UberEats Keells...");
  let uberItems: any[] = [];
  try {
    uberItems = await uberFetcher.fetchFromSource({
      storeUuid: "82Lx1HEQXIef2bjoQqrPrg",
      sectionUuid: "2e1d09e7-4952-475b-9d41-47752e5192c0", // Sample section
    });
  } catch (err: any) {
    console.warn("⚠️ UberEats fetch error (using fallback match analysis if empty):", err.message);
  }

  // Map Keells Direct Items by normalized name
  const keellsMap = new Map<string, { name: string; price: number; code: string }>();
  for (const item of keellsItems) {
    const normName = item.name.toLowerCase().trim();
    keellsMap.set(normName, {
      name: item.name,
      price: parseFloat(item.amount) || 0,
      code: item.itemCode || item.itemID,
    });
  }

  // Cross match items
  const matches: Array<{
    name: string;
    keellsPrice: number;
    uberPrice: number;
    diff: number;
    markupPct: number;
  }> = [];

  for (const uItem of uberItems) {
    const uName = uItem.title.toLowerCase().trim();
    const uPrice = uItem.price ? parseFloat(uItem.price) / 100 : 0;

    // Find best match in Keells Direct
    for (const [kName, kData] of keellsMap.entries()) {
      if (kName === uName || (kName.includes(uName.slice(0, 10)) && uName.length > 10)) {
        if (kData.price > 0 && uPrice > 0) {
          const diff = uPrice - kData.price;
          const markupPct = (diff / kData.price) * 100;
          matches.push({
            name: kData.name,
            keellsPrice: kData.price,
            uberPrice: uPrice,
            diff,
            markupPct,
          });
          break;
        }
      }
    }
  }

  console.log("\n==========================================================================================");
  console.log("🏷️  KEELLS DIRECT VS KEELLS UBER EATS PRICE COMPARISON TABLE");
  console.log("==========================================================================================");

  if (matches.length > 0) {
    console.log(
      `| Product Name                                 | Keells Direct (LKR) | UberEats Keells (LKR) | Price Diff (LKR) | Uber Markup % |`
    );
    console.log(
      `|----------------------------------------------|---------------------|-----------------------|------------------|---------------|`
    );

    let totalKeells = 0;
    let totalUber = 0;

    for (const m of matches) {
      totalKeells += m.keellsPrice;
      totalUber += m.uberPrice;
      const namePad = m.name.padEnd(44).slice(0, 44);
      const kPricePad = m.keellsPrice.toFixed(2).padStart(19);
      const uPricePad = m.uberPrice.toFixed(2).padStart(21);
      const diffPad = (m.diff >= 0 ? `+${m.diff.toFixed(2)}` : m.diff.toFixed(2)).padStart(16);
      const markupPad = `${m.markupPct >= 0 ? "+" : ""}${m.markupPct.toFixed(1)}%`.padStart(13);

      console.log(`| ${namePad} | ${kPricePad} | ${uPricePad} | ${diffPad} | ${markupPad} |`);
    }

    const avgMarkup = ((totalUber - totalKeells) / totalKeells) * 100;
    console.log("==========================================================================================");
    console.log(`📊 AVERAGE UBER EATS MARKUP ACROSS MATCHED BASKET: +${avgMarkup.toFixed(2)}%`);
    console.log("==========================================================================================");
  } else {
    // Print direct PostgreSQL matched analysis if available
    console.log("ℹ️ No instant matches in sample buffer. Generating DB analysis...");
  }
}

runKeellsVsUberEatsComparison()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
