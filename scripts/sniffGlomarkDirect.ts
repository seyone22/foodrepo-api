import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function sniffGlomarkDirect() {
  console.log("🔍 Testing Softlogic GLOMARK Search Endpoint...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("search") || url.includes("product") || url.includes("ajax")) {
      console.log(`📡 GLOMARK Response [${res.status()}]: ${url}`);
      try {
        const text = await res.text();
        if (text.startsWith("{") || text.startsWith("[")) {
          const json = JSON.parse(text);
          console.log(`📦 JSON Keys: ${JSON.stringify(Object.keys(json))}`);
        }
      } catch (_) {}
    }
  });

  try {
    console.log("🌐 Navigating to GLOMARK Search for 'milk'...");
    await page.goto("https://glomark.lk/search?q=milk", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    // Extract product cards from GLOMARK search DOM
    const products = page.locator('.product-box, .product-card, div[class*="product"]');
    const count = await products.count();
    console.log(`\n📦 DOM Product Cards Found: ${count}`);

    const productTitles = await page.locator('h3, h4, .product-name, a[href*="/product/"]').allInnerTexts();
    console.log("📋 Sample Glomark Product Titles Extracted:");
    for (const t of productTitles.filter((t) => t.trim().length > 3).slice(0, 10)) {
      console.log(`  ├─ ${t.replace(/\n/g, " | ")}`);
    }
  } catch (err: any) {
    console.error("❌ Glomark Direct error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffGlomarkDirect()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
