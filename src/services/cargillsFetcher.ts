import { eq } from "drizzle-orm";
import { chromium } from "playwright";
import {
  type FetchProductParams,
  SupermarketFetcher,
} from "@/services/supermarketFetcher";
import { db } from "@/database/database.module";
import { normalizePrice } from "@/common/utils/normalize-qty.util";
import { priceSources, products } from "@/database/schema";

export const CARGILLS_CAT_MAP: Record<string, string> = {
  FT: "Fruits",
  VG: "Vegetables",
  DY: "Dairy",
  FC: "Food Cupboard",
  BV: "Beverages",
  TC: "Tea & Coffee",
  MT: "Meats",
  SF: "Seafood",
  FF: "Frozen Food",
  RI: "Rice",
  SS: "Seeds & Spices",
  CE: "Cooking Essentials",
  SC: "Snacks & Confectionery",
  DI: "Desserts & Ingredients",
  BK: "Bakery",
  HB: "Health & Beauty",
  HH: "Household",
  ST: "Stationery",
  PP: "Pet Products",
  BP: "Baby Products",
  PI: "Party Shop",
  FA: "Fashion",
  AC: "Auto Care",
  CD: "Christmas Decor",
  CT: "Christmas Treats",
  CA: "Charity & Donations",
};

export class CargillsFetcher extends SupermarketFetcher {
  sourceName = "Cargills";
  country = "LK";

  sourceId?: string;

  private baseUrl = "https://cargillsonline.com";

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

  async fetchFromSource(params: FetchProductParams = {}): Promise<any[]> {
    await this.ensureSourceId();

    console.log("🟢 Launching headless browser for Cargills session...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });

    await context.addCookies([
      {
        name: "WSTAPWS",
        value: "1",
        domain: "cargillsonline.com",
        path: "/",
      },
    ]);

    const page = await context.newPage();

    try {
      console.log("🌐 Navigating to Cargills homepage...");
      await page.goto(this.baseUrl, {
        waitUntil: "networkidle",
        timeout: 30000,
      });

      const ageBtn = page.locator('text="I am 21+"');
      if (await ageBtn.count()) {
        console.log("🔞 Age modal detected. Clicking...");
        await ageBtn.click();
        await page.waitForTimeout(500);
      } else {
        console.log("✅ No age modal detected.");
      }

      const pincodeInput = page.locator('input[name="pincode"]');
      if (await pincodeInput.count()) {
        console.log("📍 Pincode input detected. Filling 'Colombo'...");
        await pincodeInput.fill("Colombo");
        const submitBtn = page.locator('button:has-text("Submit")');
        if (await submitBtn.count()) {
          console.log("📨 Submitting pincode...");
          await submitBtn.click();
          await page.waitForTimeout(1000);
        }
      } else {
        console.log("✅ No pincode modal detected.");
      }

      const apiUrl = `${this.baseUrl}/Web/GetMenuCategoryItemsPagingV3/`;
      const commonHeaders = {
        "Content-Type": "application/json;charset=utf-8",
        Accept: "application/json, text/plain, */*",
        Origin: this.baseUrl,
        Referer: this.baseUrl,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      };

      if (params.ingredientName && params.ingredientName.trim()) {
        console.log(
          `📡 Performing targeted search for: "${params.ingredientName}"...`,
        );
        const body = {
          CategoryId: "",
          Search: params.ingredientName.trim(),
          Filter: "Wwzpa2LygAJqAK1uM94i8A==",
          PageIndex: 1,
          PageSize: params.itemsPerPage || 1000,
          BannerId: "",
          SectionId: "",
          CollectionId: "",
          SectionType: "",
          DataType: "",
          SubCatId: "-1",
          PromoId: "",
        };

        const response = await context.request.post(apiUrl, {
          headers: commonHeaders,
          data: body,
          timeout: 30000,
        });

        const data = await response.json();
        if (Array.isArray(data)) {
          if (data.length === 1 && data[0]?.ItemName === "No Products Found") {
            return [];
          }
          return data;
        }
        return data.Items || [];
      }

      console.log(
        "📂 Initiating full catalog scrape via dynamic category discovery...",
      );
      const catResp = await context.request.post(
        `${this.baseUrl}/Web/GetCategoriesV1`,
        {
          headers: commonHeaders,
          data: {},
          timeout: 30000,
        },
      );

      const categories: any[] = await catResp.json();
      console.log(`✅ Discovered ${categories.length} Cargills categories.`);

      const allItemsMap = new Map<string, any>();
      const pageSize = 1000;

      for (const cat of categories) {
        if (!cat.EnId) continue;
        const catName = cat.MenuCategoryName || cat.Abbreviation || "Unknown";
        let pageIndex = 1;
        let hasMore = true;

        while (hasMore) {
          console.log(
            `  └─ Fetching category [${cat.Abbreviation || ""}] "${catName}" (Page ${pageIndex})...`,
          );
          const response = await context.request.post(apiUrl, {
            headers: commonHeaders,
            data: {
              CategoryId: cat.EnId,
              Search: "",
              Filter: "Wwzpa2LygAJqAK1uM94i8A==",
              PageIndex: pageIndex,
              PageSize: pageSize,
              BannerId: "",
              SectionId: "",
              CollectionId: "",
              SectionType: "",
              DataType: "",
              SubCatId: "-1",
              PromoId: "",
            },
            timeout: 30000,
          });

          if (!response.ok()) {
            console.warn(
              `⚠️ Failed to fetch category ${catName}: HTTP ${response.status()}`,
            );
            break;
          }

          const items: any[] = await response.json();
          if (
            !Array.isArray(items) ||
            items.length === 0 ||
            items[0]?.ItemName === "No Products Found"
          ) {
            break;
          }

          for (const item of items) {
            const key = item.SKUCODE || String(item.Id);
            if (key && !allItemsMap.has(key)) {
              allItemsMap.set(key, item);
            }
          }

          const totalCount = parseInt(items[0]?.TotalCount, 10) || items.length;
          if (pageIndex * pageSize < totalCount) {
            pageIndex++;
            await new Promise((r) => setTimeout(r, 100));
          } else {
            hasMore = false;
          }
        }

        await new Promise((r) => setTimeout(r, 150));
      }

      const allProducts = Array.from(allItemsMap.values());
      console.log(
        `🎉 Cargills: Successfully extracted ${allProducts.length} unique products across all categories!`,
      );
      return allProducts;
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  mapToProduct(raw: any, _ingredientId?: string): typeof products.$inferInsert {
    if (!this.sourceId) {
      throw new Error(
        "CargillsFetcher: sourceId not resolved — call fetchFromSource() first",
      );
    }

    return {
      name: raw.ItemName,
      brand: raw.BrandName || null,
      sourceId: this.sourceId,
      unit: raw.UOM || "unit",
      quantity: raw.UnitSize ? parseFloat(raw.UnitSize) : 1,

      averageSale: parseFloat(raw.averageSale) || 0,

      price: normalizePrice(raw.Price),
      mrp: raw.Mrp ? normalizePrice(raw.Mrp) : null,
      currency: "LKR",
      isPromotionApplied: raw.IsPromo || false,
      promotionDiscountValue: normalizePrice(raw.DiscountAmt),

      dietaryType: raw.Type || null,
      packSize: raw.PackSize ? parseInt(raw.PackSize) : null,
      searchTerms: raw.SearchTerm
        ? raw.SearchTerm.split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [],

      url: raw.ItemImage || null,
      externalId: raw.SKUCODE ? String(raw.SKUCODE) : null,
      sku: raw.SKUCODE ? String(raw.SKUCODE) : null,
      stockInHand: raw.Inventory ? parseFloat(raw.Inventory) : null,

      departmentCode: raw.CategoryCode ? String(raw.CategoryCode) : "Misc",
      categoryPath: [
        raw.CategoryName ||
          (raw.CategoryCode ? CARGILLS_CAT_MAP[raw.CategoryCode] : undefined),
        raw.SubCategoryName,
      ].filter(Boolean) as string[],

      raw: JSON.stringify(raw),
      lastFetched: new Date(),
    };
  }
}
