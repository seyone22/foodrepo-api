import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const MYARPICO_BASE = "https://myarpico.com";

async function checkFullArpicoPagination() {
  console.log("🔍 Inspecting Full Arpico OpenCart Category Page Depth...\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    // Check major categories (Grocery path=70, Household path=78, Personal Care path=76)
    const testCategories = [
      { name: "Grocery", path: "70" },
      { name: "Household", path: "78" },
      { name: "Personal Care", path: "76" },
    ];

    for (const cat of testCategories) {
      console.log(`🌐 Checking max page depth for category "${cat.name}" (path=${cat.path})...`);
      const catUrl = `${MYARPICO_BASE}/index.php?route=product/category&language=en-gb&path=${cat.path}`;
      await page.goto(catUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);

      const pageInfo = await page.evaluate(() => {
        const paginationLinks = Array.from(document.querySelectorAll(".pagination a"));
        const pages = paginationLinks
          .map((a) => {
            const href = a.getAttribute("href") || "";
            const pageMatch = href.match(/page=(\d+)/);
            return pageMatch ? parseInt(pageMatch[1], 10) : 1;
          })
          .filter((n) => !isNaN(n));

        const maxPage = pages.length > 0 ? Math.max(...pages) : 1;
        const totalText = document.querySelector(".col-sm-6.text-end")?.textContent?.trim() || "";

        return { maxPage, totalText };
      });

      console.log(`  ├─ Max Pagination Page Number Discovered: Page ${pageInfo.maxPage}`);
      console.log(`  └─ Total Items Header: "${pageInfo.totalText}"\n`);
    }
  } catch (err: any) {
    console.error("❌ Error checking pagination:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

checkFullArpicoPagination()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
