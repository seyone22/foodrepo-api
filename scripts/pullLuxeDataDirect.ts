import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function pullLuxeDataDirect() {
  console.log("🔍 Querying Luxe Supermarket (Glomark Luxe / Keells Luxe Negombo)...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  let capturedHeaders: any = null;

  page.on("request", (req) => {
    if (req.url().includes("_p/api/") && req.headers()["x-csrf-token"]) {
      capturedHeaders = req.headers();
    }
  });

  try {
    // Set Negombo delivery location on UberEats
    const negomboStoreUrl =
      "https://www.ubereats.com/category/colombo-western/grocery?pl=JTdCJTIyYWRkcmVzcyUyMiUzQSUyMk5lZ29tYm8lMjIlMkMlMjJyZWZlcmVuY2UlMjIlM0ElMjJDaElKNWVxT05YQW40am9SVjlqTFpqbE01QnclMjIlMkMlMjJyZWZlcmVuY2VUeXBlJTIyJTNBJTIyZ29vZ2xlX3BsYWNlcyUyMiUyQy%22bGF0aXR1ZGUlMjIlM0E3LjIwODM2NzYlMkMlMjJsb25naXR1ZGUlMjIlM0E3OS44Mzk3NDc0JTdE";

    console.log("🌐 Loading UberEats Negombo Grocery Category page...");
    await page.goto(negomboStoreUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    const storeCards = page.locator('a[href*="/store/"]');
    const total = await storeCards.count();

    console.log(`🏬 Discovered ${total} Grocery Outlets servicing Negombo region:`);

    let targetStoreUuid = "";
    let targetStoreTitle = "";

    for (let i = 0; i < Math.min(total, 12); i++) {
      const text = (await storeCards.nth(i).innerText()).replace(/\n/g, " | ");
      const href = (await storeCards.nth(i).getAttribute("href")) || "";
      const uuidMatch = href.match(/\/([a-zA-Z0-9_-]{22})/);
      const uuid = uuidMatch ? uuidMatch[1] : "";

      console.log(`  ├─ Outlet [${i + 1}]: "${text}" (UUID: ${uuid})`);

      if (text.toLowerCase().includes("luxe") || text.toLowerCase().includes("glomark")) {
        targetStoreUuid = uuid;
        targetStoreTitle = text;
      }
    }

    if (!targetStoreUuid && total > 0) {
      const firstHref = (await storeCards.first().getAttribute("href")) || "";
      const uuidMatch = firstHref.match(/\/([a-zA-Z0-9_-]{22})/);
      targetStoreUuid = uuidMatch ? uuidMatch[1] : "";
      targetStoreTitle = await storeCards.first().innerText();
    }

    if (capturedHeaders && targetStoreUuid) {
      console.log(`\n📡 Fetching catalog sections for Luxe store: "${targetStoreTitle}"...`);
      const storeRes = await context.request.post("https://www.ubereats.com/_p/api/getStoreV1", {
        headers: {
          "x-csrf-token": capturedHeaders["x-csrf-token"],
          "x-uber-client-gitref": capturedHeaders["x-uber-client-gitref"] || "",
          cookie: capturedHeaders["cookie"],
          "content-type": "application/json",
        },
        data: { storeUuid: targetStoreUuid, sfUuid: targetStoreUuid },
      });

      if (storeRes.ok()) {
        const json = await storeRes.json();
        const data = json?.data;

        console.log("\n==========================================================");
        console.log(`🏬 LUXE STORE METADATA: ${data?.title}`);
        console.log("==========================================================");
        console.log(`  - Address: ${data?.location?.address}`);
        console.log(`  - Rating: ${data?.rating?.ratingValue} ⭐ (${data?.rating?.reviewCount} reviews)`);
        console.log(`  - Operating Hours: ${data?.isOpen ? "Open Now" : "Closed"}`);

        const sections = data?.sections || [];
        console.log(`  - Department Sections (${sections.length}):`);
        for (const s of sections) {
          console.log(`    ├─ Category: "${s.title}" (UUID: ${s.uuid})`);
        }
      }
    }
  } catch (err: any) {
    console.error("❌ Sniff error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

pullLuxeDataDirect()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
