import { SupermarketFetcher } from "@/services/supermarketFetcher";
import { db } from "@/database/database.module";
import { priceSources, products } from "@/database/schema";
import { eq } from "drizzle-orm";

export class SparFetcher extends SupermarketFetcher {
  sourceName = "SPAR";
  country = "LK";

  sourceId?: string;

  private BASE_API = "https://spar2u.lk";

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

  async fetchFromSource(
    params: {
      ingredientName?: string;
      itemsPerPage?: number;
      pageCount?: number;
    } = {},
  ): Promise<any[]> {
    await this.ensureSourceId();

    const itemsPerPage = params.itemsPerPage || 250;
    const maxPages = params.pageCount || 15;

    const allItems: any[] = [];

    async function backoff(attempt: number) {
      const base = 300;
      const max = 5000;
      const jitter = Math.random() * 200;
      const delay = Math.min(base * Math.pow(2, attempt), max) + jitter;
      return new Promise((res) => setTimeout(res, delay));
    }

    for (let page = 1; page <= maxPages; page++) {
      const url = `${this.BASE_API}/products.json?limit=${itemsPerPage}&page=${page}`;
      console.log(`Fetching SPAR page ${page}...`);

      let attempts = 0;
      let json: any = null;

      while (attempts < 5) {
        attempts++;

        const res = await fetch(url, {
          headers: {
            "User-Agent": "IngredientScraper/1.0",
            Accept: "application/json",
          },
        });

        if (res.status === 429 || res.status === 503) {
          console.warn(
            `Rate limited (page ${page}, attempt ${attempts}), backing off...`,
          );
          await backoff(attempts);
          continue;
        }

        if (!res.ok) {
          console.warn(`SPAR fetch failed for page ${page}: ${res.statusText}`);
          break;
        }

        try {
          json = await res.json();
        } catch {
          console.warn(`Invalid JSON, page ${page}`);
          break;
        }

        break;
      }

      if (!json) continue;

      const productsList = json.products || [];

      if (!productsList.length) {
        console.log("No more products, stopping early.");
        break;
      }

      allItems.push(...productsList);
      await new Promise((r) => setTimeout(r, 350));
    }

    console.log(`Total SPAR products fetched: ${allItems.length}`);
    return allItems;
  }

  mapToProduct(raw: any, _ingredientId?: string): typeof products.$inferInsert {
    if (!this.sourceId) {
      throw new Error(
        "SparFetcher: sourceId not resolved — call fetchFromSource() first",
      );
    }

    const variant =
      raw.variants?.find((v: { available: any }) => v.available) ||
      raw.variants?.[0];

    const imageUrl =
      raw.images && raw.images.length > 0 ? raw.images[0].src : null;

    const eanBarcode =
      variant?.sku && /^\d{12,14}$/.test(variant.sku.trim())
        ? variant.sku.trim()
        : null;

    const mrp =
      variant?.compare_at_price != null
        ? parseFloat(variant.compare_at_price)
        : null;

    const quantity = variant?.grams
      ? variant.grams
      : raw.quantity
        ? Number(raw.quantity)
        : 1;
    const unit = variant?.grams ? "g" : raw.unit || null;

    return {
      name: raw.title,
      brand: raw.vendor || null,
      sourceId: this.sourceId,
      unit: unit,
      quantity: quantity,

      price: variant?.price != null ? parseFloat(variant.price) : 0,
      mrp: mrp,
      currency: "LKR",

      eanBarcode: eanBarcode,
      sku: variant?.sku?.toString() || null,
      externalId: raw.id?.toString(),

      stockInHand: parseFloat(raw.stockInHand) || 0,
      averageSale: parseFloat(raw.averageSale) || 0,

      url: imageUrl,

      departmentCode: raw.product_type || "Misc",
      categoryPath: raw.product_type ? [raw.product_type] : [],
      searchTerms: Array.isArray(raw.tags)
        ? raw.tags
        : typeof raw.tags === "string"
          ? raw.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
          : [],

      raw: JSON.stringify(raw),
      lastFetched: new Date(),
    };
  }
}
