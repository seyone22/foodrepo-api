import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const MYARPICO_URL = "https://myarpico.com";

async function sniffMyArpico() {
  console.log("🔍 Extracting Arpico Webstore (myarpico.com) OpenCart Product Catalog...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    const searchUrl = `${MYARPICO_URL}/index.php?route=product/search&search=milk`;
    console.log(`🌐 Navigating to Arpico Search: ${searchUrl}...`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    const items = await page.evaluate(() => {
      const results: any[] = [];
      const cards = document.querySelectorAll(".product-thumb, .product-layout, div[class*='product']");

      cards.forEach((card) => {
        const titleEl = card.querySelector(".caption a, h4 a, .name a, .title a");
        const priceEl = card.querySelector(".price, .price-new, .price-normal");
        const oldPriceEl = card.querySelector(".price-old");
        const imgEl = card.querySelector("img");
        const linkEl = card.querySelector("a[href*='product_id']");

        if (titleEl && priceEl) {
          const href = linkEl?.getAttribute("href") || titleEl.getAttribute("href") || "";
          const idMatch = href.match(/product_id=(\d+)/);

          results.push({
            title: titleEl.textContent?.trim() || "",
            productId: idMatch ? idMatch[1] : null,
            priceText: priceEl.textContent?.trim() || "",
            oldPriceText: oldPriceEl?.textContent?.trim() || null,
            image: imgEl?.getAttribute("src") || "",
            url: href,
          });
        }
      });

      return results;
    });

    console.log("\n==========================================================");
    console.log(`📦 DISCOVERED MYARPICO PRODUCT ITEMS: ${items.length}`);
    console.log("==========================================================");

    for (const item of items.slice(0, 10)) {
      console.log(`  ├─ Name: ${item.title}`);
      console.log(`  │  Product ID: ${item.productId}`);
      console.log(`  │  Price: ${item.priceText}`);
      console.log(`  │  Old Price: ${item.oldPriceText}`);
      console.log(`  │  Image: ${item.image}`);
      console.log(`  │  Link: ${item.url}\n`);
    }
  } catch (err: any) {
    console.error("❌ myarpico sniff error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffMyArpico()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
