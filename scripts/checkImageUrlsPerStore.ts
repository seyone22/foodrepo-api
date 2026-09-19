import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources } from "../src/utils/schema";
import { eq, sql } from "drizzle-orm";

async function inspectStores() {
  const stores = await db.select().from(priceSources);

  for (const store of stores) {
    const prods = await db
      .select({ name: products.name, url: products.url, raw: products.raw })
      .from(products)
      .where(eq(products.sourceId, store.id))
      .limit(3);

    console.log(`\n=================== STORE: ${store.name} (BaseUrl: ${store.baseUrl}) ===================`);
    for (const p of prods) {
      console.log(`Title : ${p.name}`);
      console.log(`URL   : ${p.url}`);
      console.log(`RAW   : ${String(p.raw).slice(0, 150)}`);
      console.log("-");
    }
  }
}

inspectStores().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
