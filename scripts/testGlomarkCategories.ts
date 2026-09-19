import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium } from "playwright";

const GLOMARK_BASE = "https://glomark.lk";

async function testGlomarkCategories() {
  console.log("🔍 Sniffing GLOMARK Category Tree & Pagination Mechanics...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log(`🌐 Loading ${GLOMARK_BASE}...`);
    await page.goto(GLOMARK_BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    const categories = await page.evaluate(() => {
      const cats: { title: string; href: string }[] = [];
      const anchors = Array.from(document.querySelectorAll("a[href*='/c/']"));

      anchors.forEach((a) => {
        const href = a.getAttribute("href") || "";
        const title = a.textContent?.trim() || "";
        if (href && !cats.some((c) => c.href === href)) {
          cats.push({ title, href });
        }
      });

      return cats;
    });

    console.log(`📂 Discovered ${categories.length} Glomark Categories:`);
    console.table(categories.slice(0, 15));

    if (categories.length > 0) {
      const sampleCat = categories[0];
      const catUrl = sampleCat.href.startsWith("http") ? sampleCat.href : `${GLOMARK_BASE}${sampleCat.href}`;
      console.log(`\n🔍 Sniffing Sample Category: "${sampleCat.title}" (${catUrl})...`);

      await page.goto(catUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);

      const catInfo = await page.evaluate(() => {
        const title = document.title;
        const breadcrumbs = Array.from(document.querySelectorAll(".breadcrumb a, ul.breadcrumb li, nav[aria-label='breadcrumb'] a"))
          .map((b) => b.textContent?.trim() || "")
          .filter(Boolean);

        const paginationLinks = Array.from(document.querySelectorAll("a[href*='page='], .pagination a, button[class*='load']"))
          .map((p) => p.getAttribute("href") || p.textContent?.trim() || "");

        const products = Array.from(document.querySelectorAll("a[href*='/p/']")).map((a) => {
          const href = a.getAttribute("href") || "";
          const card = a.closest("div");
          return { href, text: card?.innerText?.slice(0, 60) };
        });

        return {
          title,
          breadcrumbs,
          paginationLinks,
          productCountOnPage: products.length,
          sampleProduct: products[0],
        };
      });

      console.log("Category Title:", catInfo.title);
      console.log("Category Breadcrumbs:", catInfo.breadcrumbs);
      console.log("Pagination Links:", catInfo.paginationLinks);
      console.log("Products Count on Page 1:", catInfo.productCountOnPage);
      console.log("Sample Product:", catInfo.sampleProduct);
    }
  } catch (err: any) {
    console.error("❌ Error sniffing Glomark:", err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

testGlomarkCategories()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
