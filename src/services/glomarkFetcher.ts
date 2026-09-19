import { chromium } from "playwright";
import {
  type FetchProductParams,
  SupermarketFetcher,
} from "@/services/supermarketFetcher";
import { db } from "@/database/database.module";
import { priceSources, products } from "@/database/schema";
import { eq } from "drizzle-orm";
import { normalizeQuantityUnit, normalizePrice } from "@/common/utils/normalize-qty.util";

export class GlomarkFetcher extends SupermarketFetcher {
  sourceName = "Glomark";
  country = "LK";

  sourceId?: string;

  private BASE_URL = "https://glomark.lk";

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
          notes: "Softlogic GLOMARK Premium Supermarket",
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

    console.log(`🟢 Launching Playwright browser for GLOMARK webstore...`);
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
        const searchUrl = `${this.BASE_URL}/search?q=${encodeURIComponent(params.ingredientName)}`;
        console.log(`-> Fetching GLOMARK search: "${params.ingredientName}"...`);
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);

        const items = await this.extractProductsFromPage(page);
        for (const item of items) {
          if (!seenProductIds.has(item.productId)) {
            seenProductIds.add(item.productId);
            allProducts.push(item);
          }
        }
      } else {
        console.log("🌐 Extracting GLOMARK Category Tree...");
        await page.goto(this.BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(3000);

        const categoryPaths = await page.evaluate(() => {
          const paths: { href: string; categoryPath: string[] }[] = [];
          const links = Array.from(document.querySelectorAll("a[href*='/c/']"));

          links.forEach((a) => {
            const href = a.getAttribute("href") || "";
            if (href && !paths.some((p) => p.href === href)) {
              const cleanHref = href.split("?")[0];
              const parts = cleanHref.split("/").filter((p) => p && p !== "c" && !/^\d+$/.test(p));
              const categoryPath = parts.map((part) =>
                part
                  .replace(/-/g, " ")
                  .replace(/\b\w/g, (l) => l.toUpperCase())
              );

              if (categoryPath.length > 0) {
                paths.push({ href: cleanHref, categoryPath });
              }
            }
          });
          return paths;
        });

        console.log(`📂 Discovered ${categoryPaths.length} GLOMARK Category Paths.`);

        for (const cat of categoryPaths) {
          let pageNum = 1;
          let hasNextPage = true;

          do {
            const catUrl = cat.href.startsWith("http")
              ? `${cat.href}?page=${pageNum}`
              : `${this.BASE_URL}${cat.href}?page=${pageNum}`;

            console.log(`-> Fetching GLOMARK category: ${cat.categoryPath.join(" > ")} (Page ${pageNum})...`);

            try {
              await page.goto(catUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
              await page.waitForTimeout(1500);

              await page.evaluate(() => window.scrollBy(0, 3000));
              await page.waitForTimeout(1000);

              const items = await this.extractProductsFromPage(page, cat.categoryPath);
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

              if (newItemsInPage === 0 || pageNum >= 25) {
                hasNextPage = false;
              } else {
                pageNum++;
              }
            } catch (err: any) {
              console.warn(`⚠️ Warning fetching GLOMARK category ${cat.href} page ${pageNum}:`, err.message);
              hasNextPage = false;
            }
          } while (hasNextPage);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }

    console.log(`✅ GLOMARK: Total extracted unique products: ${allProducts.length}`);
    return allProducts;
  }

  private async extractProductsFromPage(page: any, categoryPath: string[] = []): Promise<any[]> {
    return await page.evaluate(({ categoryPath }: { categoryPath: string[] }) => {
      const results: any[] = [];
      const links = Array.from(document.querySelectorAll("a[href*='/p/']"));

      links.forEach((linkEl) => {
        const href = linkEl.getAttribute("href") || "";
        const card = linkEl.closest("div");

        const cardText = card?.innerText || "";
        const priceMatch = cardText.match(/Rs\.?\s*([\d,]+(?:\.\d{2})?)/g);

        const imgEl = card?.querySelector("img");
        const img = imgEl?.getAttribute("src") || imgEl?.getAttribute("data-src") || "";

        if (href && priceMatch && priceMatch.length > 0) {
          const slugMatch = href.match(/\/([^\/]+)\/p\/(\d+)/);
          if (slugMatch) {
            const rawSlug = slugMatch[1];
            const productId = slugMatch[2];

            const title = rawSlug
              .replace(/-/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase());

            const priceText = priceMatch[0];
            const mrpText = priceMatch.length > 1 ? priceMatch[1] : null;

            results.push({
              title,
              productId,
              priceText,
              mrpText,
              image: img,
              url: href,
              categoryPath: categoryPath || [],
            });
          }
        }
      });

      return results;
    }, { categoryPath });
  }

  mapToProduct(raw: any, _ingredientId?: string): typeof products.$inferInsert {
    if (!this.sourceId) {
      throw new Error(
        "GlomarkFetcher: sourceId not resolved — call fetchFromSource() first"
      );
    }

    let price = normalizePrice(raw.priceText);
    const mrp = raw.mrpText ? normalizePrice(raw.mrpText) : null;
    const { quantity, unit } = normalizeQuantityUnit(raw.title);

    // Glomark bulk loose items (e.g. Sugar Brown Bulk, Sugar White Bulk, Rice Bulk)
    // display prices per 100g on their web storefront (price < 60 LKR with unit defaulted to kg).
    // Normalize to 1kg basis to match supermarket packaging standards.
    if (
      raw.title?.toLowerCase().includes("bulk") &&
      price > 0 &&
      price < 60 &&
      unit === "kg" &&
      quantity === 1
    ) {
      price = price * 10;
    }

    const fullUrl = raw.url
      ? raw.url.startsWith("http")
        ? raw.url
        : `${this.BASE_URL}${raw.url}`
      : null;

    return {
      name: raw.title,
      sourceId: this.sourceId,
      price: price,
      currency: "LKR",

      quantity: quantity,
      unit: unit,

      mrp: mrp && mrp > price ? mrp : null,
      departmentCode: "Glomark_Supermarket",
      categoryPath: Array.isArray(raw.categoryPath) ? raw.categoryPath : [],
      searchTerms: [raw.title.toLowerCase()],

      url: raw.image || fullUrl,
      externalId: raw.productId || `glomark-${raw.title.replace(/\s+/g, "-").toLowerCase()}`,

      raw: JSON.stringify(raw),
      lastFetched: new Date(),
    };
  }
}
