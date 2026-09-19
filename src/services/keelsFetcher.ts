import { chromium } from "playwright";
import { SupermarketFetcher } from "@/services/supermarketFetcher";
import { db } from "@/database/database.module";
import { priceSources, products } from "@/database/schema";
import { eq } from "drizzle-orm";

export const KEELLS_DEPT_MAP: Record<string, string> = {
  G: "Groceries",
  H: "Household & Personal Care",
  B: "Beverages",
  D: "Dairy & Chilled",
  C: "Chilled & Dairy Goods",
  V: "Fruits & Vegetables",
  F: "Fresh Produce & Dried Fruits",
  S: "Seafood & Fish",
  M: "Meat & Delicatessen",
  T: "Meats & Special Cold Cuts",
  K: "Kitchenware & General",
  U: "Vouchers & Services",
  D03: "Electronics & Household",
};

export class KeellsFetcher extends SupermarketFetcher {
  sourceName = "Keells";
  country = "LK";

  sourceId?: string;

  private BASE_API = "https://zebraliveback.keellssuper.com";
  private LOGIN_URL = `${this.BASE_API}/1.0/Login/GuestLogin`;
  private PRODUCTS_URL = `${this.BASE_API}/2.0/WebV2/GetItemDetails`;

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
        .values({ name: this.sourceName, country: this.country, type: "api" })
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

  async fetchFromSource(params: {
    ingredientName?: string;
    itemsPerPage?: number;
  }): Promise<any[]> {
    await this.ensureSourceId();

    console.log("🟢 Launching headless browser for Keells...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    try {
      const loginRes = await context.request.post(this.LOGIN_URL, {
        headers: {
          Accept: "application/json, text/plain, */*",
          Origin: "https://www.keellssuper.com",
          Referer: "https://www.keellssuper.com/",
        },
      });

      if (!loginRes.ok()) {
        throw new Error(`Keells login failed: ${loginRes.statusText()}`);
      }

      const loginBody = await loginRes.json();
      const userSessionID = loginBody?.result?.userSessionID;
      if (!userSessionID) {
        throw new Error("Keells login failed: no userSessionID in response");
      }

      const itemDescription = params.ingredientName || "";
      const itemsPerPage = params.itemsPerPage || 100;
      let pageNo = 1;
      let allItems: any[] = [];
      let totalPages = 1;

      do {
        const url = new URL(this.PRODUCTS_URL);

        url.searchParams.set("pageNo", pageNo.toString());
        url.searchParams.set("itemsPerPage", itemsPerPage.toString());
        url.searchParams.set("itemDescription", itemDescription);
        url.searchParams.set("outletCode", "SCDR");
        url.searchParams.set("departmentId", "");
        url.searchParams.set("subDepartmentId", "");
        url.searchParams.set("categoryId", "");
        url.searchParams.set("itemPricefrom", "0");
        url.searchParams.set("itemPriceTo", "5000");
        url.searchParams.set("isFeatured", "0");
        url.searchParams.set("isPromotionOnly", "false");
        url.searchParams.set("promotionCategory", "");
        url.searchParams.set("sortBy", "default");
        url.searchParams.set("BrandId", "");
        url.searchParams.set("storeName", "");
        url.searchParams.set("subDeaprtmentCode", "");
        url.searchParams.set("isShowOutofStockItems", "true");
        url.searchParams.set("brandName", "");

        const response = await context.request.get(url.toString(), {
          headers: {
            usersessionid: userSessionID,
            Accept: "application/json, text/plain, */*",
            Origin: "https://www.keellssuper.com",
            Referer: "https://www.keellssuper.com/",
          },
        });

        if (!response.ok()) {
          throw new Error(`Keells fetch failed: ${response.statusText()}`);
        }

        const json = await response.json();
        const items = json?.result?.itemDetailResult?.itemDetails || [];
        allItems.push(...items);

        totalPages = json?.result?.itemDetailResult?.pageCount || 1;
        pageNo++;
      } while (pageNo <= totalPages);

      console.log(`✅ Keells: Fetched ${allItems.length} raw products.`);
      return allItems;
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  mapToProduct(raw: any, _ingredientId?: string): typeof products.$inferInsert {
    if (!this.sourceId) {
      throw new Error(
        "KeellsFetcher: sourceId not resolved — call fetchFromSource() first",
      );
    }

    const item = raw;

    const eanBarcode =
      item.barcode && /^\d{12,14}$/.test(String(item.barcode).trim())
        ? String(item.barcode).trim()
        : null;

    const mrp =
      item.isPromotionApplied && item.promotionDiscountValue
        ? (parseFloat(item.amount) || 0) + parseFloat(item.promotionDiscountValue)
        : null;

    return {
      name: item.name,
      brand: raw.brandDetail?.brandName || "",
      sourceId: this.sourceId,
      unit: item.uom || "unit",

      price: parseFloat(item.amount) || 0,
      mrp: mrp,
      currency: "LKR",
      isPromotionApplied: item.isPromotionApplied ?? false,
      promotionDiscountValue: parseFloat(item.promotionDiscountValue) || 0,

      quantity: parseFloat(item.minQty) || 1,
      stockInHand: parseFloat(item.stockInHand) || 0,
      averageSale: parseFloat(item.averageSale) || 0,

      url: item.imageUrl || "",
      externalId: item.itemID?.toString(),
      sku: item.itemCode?.toString(),
      departmentCode: item.departmentCode,
      subDepartmentCode: raw.categoryDetail?.subDepartmentCode,
      categoryPath: [
        raw.categoryDetail?.departmentName || (item.departmentCode ? KEELLS_DEPT_MAP[item.departmentCode] : undefined),
        raw.categoryDetail?.subDepartmentName,
        raw.categoryDetail?.categoryName,
      ].filter(Boolean) as string[],

      raw: JSON.stringify(raw),
      lastFetched: new Date(),
    };
  }
}
