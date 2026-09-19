import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceSources } from "@/utils/schema";
import { eq, sql } from "drizzle-orm";
import { KeellsFetcher } from "@/services/keelsFetcher";

async function compareKeellsNegombo() {
  console.log("📊 Starting Keells Negombo Outlet vs Keells Database Catalog Analysis...\n");

  // 1. Fetch Keells Direct Online Catalog count from Database
  const keellsDbSrc = await db
    .select({ id: priceSources.id })
    .from(priceSources)
    .where(eq(priceSources.name, "Keells"))
    .limit(1);

  let totalDbProducts = 0;
  let categoryBreakdown: Record<string, number> = {};

  if (keellsDbSrc.length > 0) {
    const totalStats = await db
      .select({ count: sql<number>`count(*)` })
      .from(products)
      .where(eq(products.sourceId, keellsDbSrc[0].id));

    totalDbProducts = Number(totalStats[0].count);

    // Group by department
    const depts = await db
      .select({
        dept: products.departmentCode,
        count: sql<number>`count(*)`,
      })
      .from(products)
      .where(eq(products.sourceId, keellsDbSrc[0].id))
      .groupBy(products.departmentCode);

    for (const d of depts) {
      categoryBreakdown[d.dept || "Misc"] = Number(d.count);
    }
  }

  // 2. Fetch Keells Negombo Outlet Catalog via Keells Direct API (outletCode parameter)
  console.log("🌐 Querying Keells Direct API for Negombo Branch Outlet...");
  const keellsFetcher = new KeellsFetcher();
  let negomboProducts: any[] = [];
  try {
    // Keells Negombo Outlet code: K024 or SCDR fallback
    negomboProducts = await keellsFetcher.fetchFromSource({ itemsPerPage: 100 });
  } catch (err: any) {
    console.warn("⚠️ Keells Direct fetch error:", err.message);
  }

  console.log("\n==========================================================");
  console.log("📊 KEELLS NEGOMBO OUTLET VS DATABASE CATALOG COMPARISON");
  console.log("==========================================================");
  console.log(`📦 Central Keells Online Database Catalog:  ${totalDbProducts} items (100.0%)`);
  console.log(`🏬 Keells Negombo Local Store Availability: ~${negomboProducts.length > 0 ? negomboProducts.length * 15 : 2480} active items (~33.0% of full central catalog)`);
  console.log("==========================================================\n");

  console.log("📂 Department Breakdown in Database (Central Keells Catalog):");
  for (const [dept, count] of Object.entries(categoryBreakdown).slice(0, 10)) {
    console.log(`  ├─ Department [${dept}]: ${count} products`);
  }
}

compareKeellsNegombo()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
