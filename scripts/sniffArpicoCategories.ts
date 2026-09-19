import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const MYARPICO_BASE = "https://myarpico.com";

async function sniffArpicoCategories() {
  console.log("🔍 Deep Crawling Arpico (myarpico.com) Category Hierarchy & Catalog Size...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log("🌐 Loading Arpico homepage to extract top-level and sub-category URLs...");
    await page.goto(MYARPICO_BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);

    // Extract all category links from menu & navigation
    const categoryLinks = await page.evaluate(() => {
      const links: { title: string; href: string; categoryId: string }[] = [];
      const anchors = Array.from(document.querySelectorAll("a[href*='product/category']"));

      anchors.forEach((a) => {
        const href = a.getAttribute("href") || "";
        const title = a.textContent?.trim() || "";
        const pathMatch = href.match(/path=([\d_]+)/);

        if (href && pathMatch) {
          links.push({
            title,
            href,
            categoryId: pathMatch[1],
          });
        }
      });

      return links;
    });

    // Deduplicate category links by categoryId
    const categoryMap = new Map<string, { title: string; href: string }>();
    for (const c of categoryLinks) {
      if (!categoryMap.has(c.categoryId)) {
        categoryMap.set(c.categoryId, c);
      }
    }

    const uniqueCategories = Array.from(categoryMap.values());

    console.log("==========================================================");
    console.log(`📂 DISCOVERED ${uniqueCategories.length} ARPICO OPEN CART CATEGORIES:`);
    console.log("==========================================================");

    let estimatedTotalProducts = 0;

    for (const cat of uniqueCategories.slice(0, 15)) {
      const catUrl = cat.href.startsWith("http") ? cat.href : `${MYARPICO_BASE}/${cat.href}`;
      console.log(`\n🔍 Checking Category: "${cat.title}" (${catUrl})...`);

      try {
        await page.goto(catUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);

        // Extract total items / pagination count from category header
        const pageText = await page.evaluate(() => {
          const resultsText = document.querySelector(".col-sm-6.text-end, .results, .pagination")?.textContent || "";
          const cardsCount = document.querySelectorAll(".product-thumb, .product-layout, div[class*='product']").length;
          return { resultsText: resultsText.trim(), cardsCount };
        });

        console.log(`  ├─ Items per Page: ${pageText.cardsCount}`);
        console.log(`  └─ Pagination Info: "${pageText.resultsText}"`);

        // Check if total items text contains numbers (e.g. "Showing 1 to 24 of 1240 (52 Pages)")
        const totalMatch = pageText.resultsText.match(/of\s+(\d+)\s*\(/i) || pageText.resultsText.match(/(\d+)\s+Items/i);
        if (totalMatch) {
          const count = parseInt(totalMatch[1], 10);
          console.log(`  ⭐ TOTAL CATEGORY PRODUCT COUNT: ${count} items`);
          estimatedTotalProducts += count;
        } else {
          estimatedTotalProducts += pageText.cardsCount * 10;
        }
      } catch (err: any) {
        console.warn(`⚠️ Warning checking category "${cat.title}":`, err.message);
      }
    }

    console.log("\n==========================================================");
    console.log(`📊 ESTIMATED TOTAL ARPICO WEBSTORE INVENTORY: ~${estimatedTotalProducts} products across ${uniqueCategories.length} categories`);
    console.log("==========================================================");
  } catch (err: any) {
    console.error("❌ Arpico category crawl error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffArpicoCategories()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
