import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/utils/db");
  const { products, mappings, priceSources } = await import("../src/utils/schema");
  const { sql } = await import("drizzle-orm");

  const [prodCount] = await db.select({ c: sql<number>`count(*)` }).from(products);
  const [mapCount] = await db.select({ c: sql<number>`count(*)` }).from(mappings);
  const sources = await db.select().from(priceSources);

  console.log("Total Products in DB:", prodCount.c);
  console.log("Total Mappings in DB:", mapCount.c);
  console.log("Price Sources:", sources.map((s) => ({ id: s.id, name: s.name })));

  process.exit(0);
}

main().catch(console.error);
