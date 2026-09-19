import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const GLOMARK_BASE = "https://glomark.lk";

async function sniffGlomark() {
  console.log("🔍 Sniffing Softlogic GLOMARK Webstore API & Structure...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  const interceptedAPIs: Map<string, { method: string; url: string; sample: any }> = new Map();

  page.on("response", async (response) => {
    const url = response.url();
    const req = response.request();

    if (
      url.includes("/api/") ||
      url.includes("/products") ||
      url.includes("/search") ||
      url.includes("/category") ||
      url.includes(".json")
    ) {
      const endpoint = url.split("?")[0];
      try {
        const text = await response.text();
        const json = JSON.parse(text);
        if (!interceptedAPIs.has(endpoint)) {
          interceptedAPIs.set(endpoint, {
            method: req.method(),
            url: url,
            sample: json,
          });
          console.log(`🎯 Intercepted GLOMARK API: [${req.method()}] ${endpoint}`);
        }
      } catch (_) {}
    }
  });

  try {
    console.log("🌐 Navigating to GLOMARK Webstore homepage...");
    await page.goto(GLOMARK_BASE, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(3000);

    // Perform a search on GLOMARK webstore
    const searchInput = page.locator('input[type="text"], input[type="search"]').first();
    if (await searchInput.count()) {
      console.log("🔍 Typing 'milk' into GLOMARK search bar...");
      await searchInput.fill("milk");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(4000);
    }

    console.log("\n========================================================");
    console.log(`📊 Discovered ${interceptedAPIs.size} GLOMARK Webstore Endpoints:`);
    console.log("========================================================\n");

    for (const [endpoint, info] of interceptedAPIs.entries()) {
      console.log(`📌 API Endpoint: ${endpoint}`);
      console.log(`   Full URL: ${info.url}`);
      console.log(`   Method: ${info.method}`);

      if (info.sample && typeof info.sample === "object") {
        const sampleStr = JSON.stringify(info.sample).slice(0, 800);
        console.log(`   Sample Payload Snippet: ${sampleStr}...`);
      }
      console.log("--------------------------------------------------------\n");
    }
  } catch (err: any) {
    console.error("❌ Glomark sniff error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffGlomark()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
