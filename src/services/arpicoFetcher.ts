import { chromium } from "playwright";
import {
  type FetchProductParams,
  SupermarketFetcher,
} from "@/services/supermarketFetcher";
import { db } from "@/database/database.module";
import { priceSources, products } from "@/database/schema";
import { eq } from "drizzle-orm";
import { normalizeQuantityUnit, normalizePrice } from "@/common/utils/normalize-qty.util";

export class ArpicoFetcher extends SupermarketFetcher {
  sourceName = "Arpico";
  country = "LK";

  sourceId?: string;

  private BASE_URL = "https://myarpico.com";

  private async ensureSourceId() {
    if (this.sourceId) return;

    const existing = await db
      .select({ id: priceSources.id })
      .from(priceSources)
      .where(eq(priceSources.name, this.sourceName))
      .limit(1);

    if (existing.length > 0) {
      this.sourceId = existing[0].id;
      return;
    }

    try {
      const [created] = await db
        .insert(priceSources)
        .values({
          name: this.sourceName,
          country: this.country,
          type: "scraper",
          notes: "Arpico Supercentre / myarpico.com Webstore",
        })
        .returning({ id: priceSources.id });
      this.sourceId = created.id;
    } catch (err) {
      const retry = await db
        .select({ id: priceSources.id })
        .from(priceSources)
        .where(eq(priceSources.name, this.sourceName))
        .limit(1);
      if (retry.length === 0) throw err;
      this.sourceId = retry[0].id;
    }
  }

  async fetchFromSource(params: FetchProductParams): Promise<any[]> {
    await this.ensureSourceId();

    console.log(`🟢 Launching Playwright browser for Arpico (myarpico.com)...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    const allProducts: any[] = [];
    const seenProductIds = new Set<string>();

    try {
      if (params.ingredientName) {
        const searchUrl = `${this.BASE_URL}/index.php?route=product/search&search=${encodeURIComponent(params.ingredientName)}`;
        console.log(`-> Fetching Arpico search: "${params.ingredientName}"...`);
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);

        const pageProducts = await this.extractProductsFromPage(page);
        for (const p of pageProducts) {
          if (!seenProductIds.has(p.productId)) {
            seenProductIds.add(p.productId);
            allProducts.push(p);
          }
        }
      } else {
        console.log("🌐 Extracting Arpico Category Tree...");
        await page.goto(this.BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3000);

        const categoryPaths = await page.evaluate(() => {
          const paths: string[] = [];
          const links = Array.from(document.querySelectorAll("a[href*='product/category']"));
          links.forEach((a) => {
            const href = a.getAttribute("href") || "";
            const match = href.match(/path=([\d_]+)/);
            if (match && !paths.includes(match[1])) {
              paths.push(match[1]);
            }
          });
          return paths;
        });

        console.log(`📂 Discovered ${categoryPaths.length} Arpico OpenCart Category Paths.`);

        for (const catPath of categoryPaths) {
          let pageNum = 1;
          let hasNextPage = true;

          do {
            const catUrl = `${this.BASE_URL}/index.php?route=product/category&language=en-gb&path=${catPath}&page=${pageNum}`;
            console.log(`-> Fetching Arpico category path: ${catPath} (Page ${pageNum})...`);

            try {
              await page.goto(catUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
              await page.waitForTimeout(2000);

              const items = await this.extractProductsFromPage(page);
              if (items.length === 0) {
                hasNextPage = false;
                break;
              }

              let newItemsInPage = 0;
              for (const item of items) {
                if (!seenProductIds.has(item.productId)) {
                  seenProductIds.add(item.productId);
                  allProducts.push(item);
                  newItemsInPage++;
                }
              }

              if (newItemsInPage === 0 || pageNum >= 50) {
                hasNextPage = false;
              } else {
                pageNum++;
              }
            } catch (err: any) {
              console.warn(`⚠️ Warning fetching category ${catPath} page ${pageNum}:`, err.message);
              hasNextPage = false;
            }
          } while (hasNextPage);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }

    console.log(`✅ Arpico: Total extracted unique products: ${allProducts.length}`);
    return allProducts;
  }

  private async extractProductsFromPage(page: any): Promise<any[]> {
    return await page.evaluate(() => {
      const results: any[] = [];
      const breadcrumbs = Array.from(document.querySelectorAll("ul.breadcrumb li a"))
        .map((el) => el.textContent?.trim() || "")
        .filter((txt) => txt && txt !== "Home" && !txt.includes("Product"));

      const cards = document.querySelectorAll(".product-thumb, .product-layout, div[class*='product']");

      cards.forEach((card) => {
        const titleEl = card.querySelector(".caption a, h4 a, .name a, .title a");
        const priceEl = card.querySelector(".price, .price-new, .price-normal");
        const oldPriceEl = card.querySelector(".price-old");
        const imgEl = card.querySelector("img");
        const linkEl = card.querySelector("a[href*='product_id']");

        if (titleEl && priceEl) {
          const title = titleEl.textContent?.trim() || "";
          const priceText = priceEl.textContent?.trim() || "";
          const oldPriceText = oldPriceEl?.textContent?.trim() || "";
          const href = linkEl?.getAttribute("href") || titleEl.getAttribute("href") || "";
          const img = imgEl?.getAttribute("src") || "";

          const idMatch = href.match(/product_id=(\d+)/);

          if (title && priceText && idMatch) {
            results.push({
              title,
              productId: idMatch[1],
              priceText,
              oldPriceText,
              image: img,
              url: href,
              categoryPath: breadcrumbs,
            });
          }
        }
      });

      return results;
    });
  }

  mapToProduct(raw: any, _ingredientId?: string): typeof products.$inferInsert {
    if (!this.sourceId) {
      throw new Error(
        "ArpicoFetcher: sourceId not resolved — call fetchFromSource() first"
      );
    }

    const price = normalizePrice(raw.priceText);
    const mrp = raw.oldPriceText ? normalizePrice(raw.oldPriceText) : null;
    const { quantity, unit } = normalizeQuantityUnit(raw.title);

    const fullUrl = raw.url
      ? raw.url.startsWith("http")
        ? raw.url
        : `${this.BASE_URL}/${raw.url}`
      : null;

    return {
      name: raw.title,
      sourceId: this.sourceId,
      price: price,
      currency: "LKR",

      quantity: quantity,
      unit: unit,

      mrp: mrp && mrp > price ? mrp : null,
      departmentCode: "Arpico_Supercentre",
      categoryPath: Array.isArray(raw.categoryPath) ? raw.categoryPath : [],
      searchTerms: [raw.title.toLowerCase()],

      url: raw.image || fullUrl,
      externalId: raw.productId || `arpico-${raw.title.replace(/\s+/g, "-").toLowerCase()}`,

      raw: JSON.stringify(raw),
      lastFetched: new Date(),
    };
  }
}
