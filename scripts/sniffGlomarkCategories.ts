import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const GLOMARK_BASE = "https://glomark.lk";

async function sniffGlomarkCategories() {
  console.log("🔍 Deep Investigating Softlogic GLOMARK (glomark.lk) Category Structure...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    console.log("🌐 Loading GLOMARK webstore homepage...");
    await page.goto(GLOMARK_BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);

    // Extract all category URLs from navigation menu & sidebar
    const categories = await page.evaluate(() => {
      const links: { title: string; href: string }[] = [];
      const anchors = Array.from(document.querySelectorAll("a[href*='/category/'], a[href*='/c/']"));

      anchors.forEach((a) => {
        const href = a.getAttribute("href") || "";
        const title = a.textContent?.trim() || "";

        if (href && !links.some((l) => l.href === href)) {
          links.push({ title, href });
        }
      });

      return links;
    });

    console.log("==========================================================");
    console.log(`📂 DISCOVERED ${categories.length} GLOMARK CATEGORY PATHS:`);
    console.log("==========================================================");

    for (const cat of categories.slice(0, 15)) {
      const catUrl = cat.href.startsWith("http") ? cat.href : `${GLOMARK_BASE}${cat.href}`;
      console.log(`\n🔍 Checking GLOMARK Category: "${cat.title}" (${catUrl})...`);

      try {
        await page.goto(catUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);

        // Scroll page to trigger infinite scroll or pagination
        await page.evaluate(() => window.scrollBy(0, 2000));
        await page.waitForTimeout(2000);

        const cardCount = await page.locator("a[href*='/p/'], .product-box, .product-card").count();
        console.log(`  ├─ DOM Product Links Discovered: ${cardCount} items`);
      } catch (err: any) {
        console.warn(`⚠️ Error checking GLOMARK category "${cat.title}":`, err.message);
      }
    }
  } catch (err: any) {
    console.error("❌ GLOMARK category sniff error:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

sniffGlomarkCategories()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
