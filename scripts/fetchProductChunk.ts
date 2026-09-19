import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products, priceSources } from "../src/utils/schema";
import { eq, sql } from "drizzle-orm";

async function getChunk(offset: number = 0, limit: number = 50) {
  const items = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      sourceId: products.sourceId,
      sourceName: priceSources.name,
    })
    .from(products)
    .innerJoin(priceSources, eq(products.sourceId, priceSources.id))
    .orderBy(products.name)
    .limit(limit)
    .offset(offset);

  console.log(JSON.stringify(items, null, 2));
}

const offset = parseInt(process.argv[2] || "0", 10);
const limit = parseInt(process.argv[3] || "50", 10);
getChunk(offset, limit);
