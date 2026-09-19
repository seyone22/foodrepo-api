import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const STORE_URL =
  "https://www.ubereats.com/store/keells-groceries-union-place/82Lx1HEQXIef2bjoQqrPrg?diningMode=DELIVERY";

async function sniffUberEatsDeep() {
  console.log("🔍 Starting Deep UberEats API Payload & Schema Sniffer...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  const keyEndpoints: Record<string, any> = {};

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("_p/api/") || url.includes("getCatalog") || url.includes("getStore") || url.includes("getSearch")) {
      const endpoint = url.split("?")[0].split("/").pop() || url;
      try {
        const text = await response.text();
        const json = JSON.parse(text);
        keyEndpoints[endpoint] = {
          url: url.split("?")[0],
          method: response.request().method(),
          headers: response.request().headers(),
          data: json,
        };
      } catch (_) {}
    }
  });

  try {
    console.log("🌐 Loading UberEats store page...");
    await page.goto(STORE_URL, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(4000);

    // Scroll page to force lazy carousels
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(3000);

    console.log("\n========================================================");
    console.log("📋 DEEP UBEREATS API PAYLOAD ANALYSIS");
    console.log("========================================================\n");

    for (const [endpoint, info] of Object.entries(keyEndpoints)) {
      console.log(`📡 ENDPOINT: [${info.method}] ${endpoint}`);
      console.log(`   Full URL: ${info.url}`);

      // Analyze specific known high-value endpoints
      if (endpoint.includes("getStore")) {
        const storeInfo = info.data?.data;
        console.log("   🏬 STORE METADATA EXPOSED:");
        console.log(`      - Store Name: ${storeInfo?.title}`);
        console.log(`      - Store Rating: ${storeInfo?.rating?.ratingValue} (${storeInfo?.rating?.reviewCount} reviews)`);
        console.log(`      - Location Coordinates: ${JSON.stringify(storeInfo?.location)}`);
        console.log(`      - Delivery ETA: ${storeInfo?.etaRange?.rawMin}-${storeInfo?.etaRange?.rawMax} mins`);
        console.log(`      - Category Sections: ${storeInfo?.sections?.map((s: any) => s.title).join(", ")}`);
      } else if (endpoint.includes("getCatalogPresentationV2")) {
        console.log("   📦 CATALOG PRESENTATION EXPOSED:");
        const catalog = info.data?.data?.catalog || [];
        console.log(`      - Sections Returned: ${catalog.length}`);

        // Extract sample item structure
        for (const sec of catalog) {
          const items = sec?.payload?.standardItemsPayload?.catalogItems || [];
          if (items.length > 0) {
            const sample = items[0];
            console.log("      - SAMPLE ITEM PAYLOAD FIELDS:");
            console.log(JSON.stringify(sample, null, 2).slice(0, 1500));
            break;
          }
        }
      } else if (endpoint.includes("getSearch")) {
        console.log("   🔍 SEARCH API EXPOSED:");
        console.log(`      - Response Keys: ${Object.keys(info.data?.data || {})}`);
      } else {
        const dataKeys = Object.keys(info.data?.data || info.data || {});
        console.log(`   - Data Keys: ${dataKeys.join(", ")}`);
      }

      console.log("--------------------------------------------------------\n");
    }
  } catch (err: any) {
    console.error("❌ Sniff error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffUberEatsDeep()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
