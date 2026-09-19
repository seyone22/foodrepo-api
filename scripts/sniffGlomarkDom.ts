import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

async function sniffGlomarkDOM() {
  console.log("🔍 Extracting GLOMARK Product Card Data & Selectors...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log("🌐 Navigating to GLOMARK 'milk' search page...");
    await page.goto("https://glomark.lk/search?q=milk", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    // Extract product items from page JS state or DOM elements
    const productItems = await page.evaluate(() => {
      const items: any[] = [];
      const cards = document.querySelectorAll(".product-box, .product-item, .product-card, .item");

      cards.forEach((card) => {
        const titleEl = card.querySelector(".product-title, .title, h3, h4, a");
        const priceEl = card.querySelector(".price, .new-price, .product-price, .amount");
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

    console.log(`📦 Found ${productItems.length} Products in GLOMARK DOM:\n`);
    for (const item of productItems.slice(0, 10)) {
      console.log(`  ├─ Name: ${item.title}`);
      console.log(`  │  Price: ${item.price}`);
      console.log(`  │  Image: ${item.image}`);
      console.log(`  │  Link: ${item.url}\n`);
    }
  } catch (err: any) {
    console.error("❌ GLOMARK DOM error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffGlomarkDOM()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
