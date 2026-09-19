import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceSources } from "@/utils/schema";
import { eq, sql } from "drizzle-orm";

async function auditSupermarketCoverage() {
  console.log("📊 Starting Comprehensive Sri Lankan Supermarket Database Coverage Audit...\n");

  const sources = await db.select().from(priceSources);

  const report: any[] = [];

  for (const src of sources) {
    const stats = await db
      .select({
        total: sql<number>`count(*)`,
        priced: sql<number>`count(case when price > 0 then 1 end)`,
        mrpCount: sql<number>`count(case when mrp > 0 then 1 end)`,
        imageCount: sql<number>`count(case when url is not null and url != '' then 1 end)`,
        stockCount: sql<number>`count(case when stock_in_hand is not null then 1 end)`,
      })
      .from(products)
      .where(eq(products.sourceId, src.id));

    const s = stats[0];
    report.push({
      name: src.name,
      country: src.country,
      type: src.type,
      total: Number(s.total),
      priced: Number(s.priced),
      mrpCount: Number(s.mrpCount),
      imageCount: Number(s.imageCount),
      stockCount: Number(s.stockCount),
    });
  }

  const grandTotal = report.reduce((sum, r) => sum + r.total, 0);

  console.log("==========================================================================================");
  console.log("🇱🇰 SRI LANKAN SUPERMARKET DATABASE COVERAGE AUDIT");
  console.log("==========================================================================================");
  console.log(
    `| Store / Source Name    | Active SKUs | Price Complete | Original MSRPs | Product Images | Stock Tracked |`
  );
  console.log(
    `|------------------------|-------------|----------------|----------------|----------------|---------------|`
  );

  for (const r of report) {
    const name = r.name.padEnd(22);
    const tot = String(r.total).padStart(11);
    const prc = `${((r.priced / (r.total || 1)) * 100).toFixed(0)}% (${r.priced})`.padStart(14);
    const mrp = `${((r.mrpCount / (r.total || 1)) * 100).toFixed(0)}% (${r.mrpCount})`.padStart(14);
    const img = `${((r.imageCount / (r.total || 1)) * 100).toFixed(0)}% (${r.imageCount})`.padStart(14);
    const stk = r.stockCount > 0 ? `${r.stockCount} tracked`.padStart(13) : "N/A".padStart(13);

    console.log(`| ${name} | ${tot} | ${prc} | ${mrp} | ${img} | ${stk} |`);
  }

  console.log("==========================================================================================");
  console.log(`🎉 GRAND TOTAL ACTIVE SRI LANKAN SUPERMARKET PRODUCTS IN DATABASE: ${grandTotal} SKUs`);
  console.log("==========================================================================================");
}

auditSupermarketCoverage()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
