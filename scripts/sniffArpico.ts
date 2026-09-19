import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const ARPICO_URL = "https://arpicosupercentre.com";

async function sniffArpico() {
  console.log("🔍 Investigating Arpico Supercentre Webstore (https://arpicosupercentre.com)...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  const interceptedAPIs: Map<string, { method: string; url: string; status: number }> = new Map();

  page.on("response", async (response) => {
    const url = response.url();
    const req = response.request();

    if (
      url.includes("api") ||
      url.includes("catalog") ||
      url.includes("search") ||
      url.includes("product") ||
      url.includes("graphql") ||
      url.includes("json")
    ) {
      const endpoint = url.split("?")[0];
      if (!interceptedAPIs.has(endpoint)) {
        interceptedAPIs.set(endpoint, {
          method: req.method(),
          url: url,
          status: response.status(),
        });
        console.log(`🎯 Intercepted Arpico API [${response.status()}]: [${req.method()}] ${endpoint}`);
      }
    }
  });

  try {
    console.log("🌐 Navigating to Arpico Supercentre webstore homepage...");
    const res = await page.goto(ARPICO_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    console.log(`✅ Arpico Webstore HTTP Status: ${res?.status()}`);
    await page.waitForTimeout(4000);

    // Search for products on Arpico webstore
    console.log("🔍 Navigating to Arpico search for 'milk'...");
    await page.goto(`${ARPICO_URL}/catalogsearch/result/?q=milk`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    const title = await page.title();
    console.log(`📄 Page Title: "${title}"`);

    // Extract product elements from Arpico search results
    const productItems = await page.evaluate(() => {
      const items: any[] = [];
      const cards = document.querySelectorAll(".product-item, .product-item-info, .product-image-container, li.item");

      cards.forEach((card) => {
        const titleEl = card.querySelector(".product-item-name, .product-name, a.product-item-link, h3, h4");
        const priceEl = card.querySelector(".price, .price-wrapper, [data-price-amount]");
        const imgEl = card.querySelector("img");
        const linkEl = card.querySelector("a");

        if (titleEl && priceEl) {
          items.push({
            title: titleEl.textContent?.trim(),
            price: priceEl.textContent?.trim(),
            image: imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src"),
            url: linkEl?.getAttribute("href"),
          });
        }
      });

      return items;
    });

    console.log("\n==========================================================");
    console.log(`📦 DISCOVERED ARPICO SUPERCENTRE WEBSTORE PRODUCTS: ${productItems.length}`);
    console.log("==========================================================");

    for (const item of productItems.slice(0, 10)) {
      console.log(`  ├─ Product: ${item.title}`);
      console.log(`  │  Price: ${item.price}`);
      console.log(`  │  Image: ${item.image}`);
      console.log(`  │  URL: ${item.url}\n`);
    }

    console.log(`\n📊 Total Arpico API Endpoints Discovered: ${interceptedAPIs.size}`);
  } catch (err: any) {
    console.error("❌ Arpico sniff error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffArpico()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
