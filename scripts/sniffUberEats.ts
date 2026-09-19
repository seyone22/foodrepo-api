import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const STORE_URL =
  "https://www.ubereats.com/store/keells-groceries-union-place/82Lx1HEQXIef2bjoQqrPrg?diningMode=DELIVERY";

async function sniffUberEats() {
  console.log("🔍 Launching browser to sniff UberEats API network traffic...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  const interceptedAPIs: Map<string, { method: string; url: string; headers: any; sampleBody: any }> = new Map();

  page.on("response", async (response) => {
    const url = response.url();
    const req = response.request();

    if (url.includes("_p/api/") || url.includes("api/get") || url.includes("api/search")) {
      const endpointName = url.split("?")[0].split("/").pop() || url;

      let bodyData: any = null;
      try {
        const text = await response.text();
        bodyData = JSON.parse(text);
      } catch (_) {
        bodyData = "<Non-JSON or Truncated>";
      }

      if (!interceptedAPIs.has(endpointName)) {
        interceptedAPIs.set(endpointName, {
          method: req.method(),
          url: url.split("?")[0],
          headers: req.headers(),
          sampleBody: bodyData,
        });
        console.log(`🎯 Intercepted API Endpoint: [${req.method()}] ${endpointName}`);
      }
    }
  });

  try {
    console.log("🌐 Navigating to UberEats Keells store page...");
    await page.goto(STORE_URL, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(5000);

    // Scroll down to trigger category carousels & lazy API calls
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(3000);

    console.log("\n========================================================");
    console.log(`📊 Discovered ${interceptedAPIs.size} Unique UberEats API Endpoints:`);
    console.log("========================================================\n");

    for (const [name, info] of interceptedAPIs.entries()) {
      console.log(`📌 Endpoint: ${name}`);
      console.log(`   URL: ${info.url}`);
      console.log(`   Method: ${info.method}`);
      console.log(`   Headers captured: x-csrf-token=${Boolean(info.headers["x-csrf-token"])}, cookie=${Boolean(info.headers["cookie"])}`);

      if (info.sampleBody && typeof info.sampleBody === "object") {
        const keys = Object.keys(info.sampleBody?.data || info.sampleBody);
        console.log(`   Response Data Keys: ${JSON.stringify(keys.slice(0, 15))}`);

        // Extract deep sample fields if present
        const sampleStr = JSON.stringify(info.sampleBody).slice(0, 500);
        console.log(`   Sample Data Snippet: ${sampleStr}...`);
      }
      console.log("--------------------------------------------------------\n");
    }
  } catch (err: any) {
    console.error("❌ Sniffing error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffUberEats()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
