import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const STORE_URL =
  "https://www.ubereats.com/store/keells-groceries-union-place/82Lx1HEQXIef2bjoQqrPrg?diningMode=DELIVERY";

async function sniffUberEatsCatalog() {
  console.log("🔍 Extracting Deep UberEats Catalog Item Schema...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  let targetHeaders: any = null;

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("_p/api/") && req.headers()["x-csrf-token"]) {
      targetHeaders = req.headers();
    }
  });

  try {
    await page.goto(STORE_URL, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(3000);

    if (!targetHeaders) {
      console.error("❌ Failed to capture CSRF token headers.");
      return;
    }

    console.log("✅ Intercepted CSRF Token & Cookies.");

    // Fetch Store Catalog structure via getStoreV1
    const storeRes = await context.request.post("https://www.ubereats.com/_p/api/getStoreV1", {
      headers: {
        "x-csrf-token": targetHeaders["x-csrf-token"],
        "x-uber-client-gitref": targetHeaders["x-uber-client-gitref"] || "",
        cookie: targetHeaders["cookie"],
        "content-type": "application/json",
      },
      data: {
        storeUuid: "82Lx1HEQXIef2bjoQqrPrg",
        sfUuid: "82Lx1HEQXIef2bjoQqrPrg",
      },
    });

    const storeJson = await storeRes.json();
    const storeData = storeJson?.data;

    console.log("\n========================================================");
    console.log(`🏬 UBEREATS STORE: ${storeData?.title}`);
    console.log(`📍 ADDRESS: ${storeData?.location?.address}`);
    console.log(`🌐 LAT/LNG: ${storeData?.location?.latitude}, ${storeData?.location?.longitude}`);
    console.log("========================================================\n");

    const sections = storeData?.sections || [];
    console.log(`📂 Found ${sections.length} Category Sections in Store.`);

    if (sections.length > 0) {
      const firstSection = sections[0];
      console.log(`\n🔍 Sniffing Section: "${firstSection.title}" (UUID: ${firstSection.uuid})...`);

      const catalogRes = await context.request.post("https://www.ubereats.com/_p/api/getCatalogPresentationV2", {
        headers: {
          "x-csrf-token": targetHeaders["x-csrf-token"],
          "x-uber-client-gitref": targetHeaders["x-uber-client-gitref"] || "",
          cookie: targetHeaders["cookie"],
          "content-type": "application/json",
        },
        data: {
          storeFilters: {
            storeUuid: "82Lx1HEQXIef2bjoQqrPrg",
            sectionUuids: [firstSection.uuid],
            subsectionUuids: null,
            shouldReturnSegmentedControlData: false,
          },
          pagingInfo: { enabled: true, offset: 0 },
          source: "NV_L1_CAROUSEL",
        },
      });

      const catalogJson = await catalogRes.json();
      const catalog = catalogJson?.data?.catalog || [];

      for (const cat of catalog) {
        const items = cat?.payload?.standardItemsPayload?.catalogItems || [];
        if (items.length > 0) {
          const item = items[0];
          console.log("\n========================================================");
          console.log(`📦 SAMPLE ITEM PAYLOAD (Raw UberEats Catalog Item):`);
          console.log("========================================================");
          console.log(JSON.stringify(item, null, 2));
          break;
        }
      }
    }
  } catch (err: any) {
    console.error("❌ Sniff error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffUberEatsCatalog()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
