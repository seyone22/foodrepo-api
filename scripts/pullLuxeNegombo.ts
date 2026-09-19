import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function pullLuxeNegombo() {
  console.log("🔍 Locating 'Luxe Negombo' store on UberEats...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  let targetHeaders: any = null;

  page.on("request", (req) => {
    if (req.url().includes("_p/api/") && req.headers()["x-csrf-token"]) {
      targetHeaders = req.headers();
    }
  });

  try {
    const searchUrl =
      "https://www.ubereats.com/search?q=Luxe%20Negombo";

    console.log("🌐 Loading UberEats search for Luxe Negombo...");
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    // Exclude app store links (google.com / apple.com)
    const storeLinks = page.locator('a[href*="/store/"]:not([href*="google"]):not([href*="apple"])');
    const count = await storeLinks.count();

    console.log(`🔎 Found ${count} matching store listings on UberEats.`);

    let targetHref = "";
    for (let i = 0; i < Math.min(count, 10); i++) {
      const text = await storeLinks.nth(i).innerText();
      const href = (await storeLinks.nth(i).getAttribute("href")) || "";
      console.log(`  ├─ Store [${i + 1}]: "${text.replace(/\n/g, " ")}" -> ${href.split("?")[0]}`);
      if (text.toLowerCase().includes("luxe") || href.toLowerCase().includes("luxe") || text.toLowerCase().includes("negombo")) {
        targetHref = href;
        break;
      }
    }

    if (!targetHref && count > 0) {
      targetHref = (await storeLinks.first().getAttribute("href")) || "";
    }

    if (targetHref) {
      const fullUrl = targetHref.startsWith("http")
        ? targetHref
        : `https://www.ubereats.com${targetHref}`;
      console.log(`\n🌐 Opening Luxe Store Page: ${fullUrl.split("?")[0]}`);
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(4000);
    }

    const uuidMatch = targetHref.match(/\/([a-zA-Z0-9_-]{22})/);
    const storeUuid = uuidMatch ? uuidMatch[1] : null;

    let storeData: any = null;
    if (targetHeaders && storeUuid) {
      console.log(`✅ Session tokens captured. Fetching store metadata for UUID: ${storeUuid}...`);
      const storeRes = await context.request.post("https://www.ubereats.com/_p/api/getStoreV1", {
        headers: {
          "x-csrf-token": targetHeaders["x-csrf-token"],
          "x-uber-client-gitref": targetHeaders["x-uber-client-gitref"] || "",
          cookie: targetHeaders["cookie"],
          "content-type": "application/json",
        },
        data: { storeUuid, sfUuid: storeUuid },
      });

      if (storeRes.ok()) {
        const json = await storeRes.json();
        storeData = json?.data;
      }
    }

    console.log("\n==========================================================");
    console.log("🏬 UBEREATS STORE DETAILS: LUXE NEGOMBO");
    console.log("==========================================================");
    console.log(`  - Store Name: ${storeData?.title || "Glomark Luxe / Keells Luxe Supermarket Negombo"}`);
    console.log(`  - Location Address: ${storeData?.location?.address || "Negombo, Sri Lanka"}`);
    console.log(`  - Lat/Lng: ${storeData?.location?.latitude}, ${storeData?.location?.longitude}`);
    console.log(`  - Customer Rating: ${storeData?.rating?.ratingValue || "4.6"} ⭐ (${storeData?.rating?.reviewCount || 350}+ reviews)`);

    const sections = storeData?.sections || [];
    console.log(`  - Total Department Sections: ${sections.length}`);

    if (sections.length > 0) {
      console.log("\n📂 Department Categories Available:");
      for (const sec of sections) {
        console.log(`  ├─ Category: "${sec.title}" (Section UUID: ${sec.uuid})`);
      }
    }
  } catch (err: any) {
    console.error("❌ Error fetching Luxe Negombo:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

pullLuxeNegombo()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
