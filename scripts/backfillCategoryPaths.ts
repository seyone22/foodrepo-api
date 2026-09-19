import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceSources } from "@/utils/schema";
import { eq, inArray } from "drizzle-orm";
import { KEELLS_DEPT_MAP } from "@/services/keelsFetcher";
import { CARGILLS_CAT_MAP } from "@/services/cargillsFetcher";

async function backfillCategoryPaths() {
  console.log("🏷️ Starting Fast Supermarket Category Path Backfill...");

  const sources = await db.select().from(priceSources);
  const keellsSource = sources.find((s) => s.name === "Keells");
  const cargillsSource = sources.find((s) => s.name === "Cargills");
  const arpicoSource = sources.find((s) => s.name === "Arpico");

  // 1. Keells Batch Updates
  if (keellsSource) {
    console.log("\n🔹 Backfilling Keells category paths in batches...");
    const keellsProducts = await db
      .select({ id: products.id, deptCode: products.departmentCode })
      .from(products)
      .where(eq(products.sourceId, keellsSource.id));

    const grouped: Record<string, string[]> = {};
    for (const p of keellsProducts) {
      if (p.deptCode && KEELLS_DEPT_MAP[p.deptCode]) {
        const cat = KEELLS_DEPT_MAP[p.deptCode];
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p.id);
      }
    }

    for (const [catName, ids] of Object.entries(grouped)) {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        await db
          .update(products)
          .set({ categoryPath: [catName] })
          .where(inArray(products.id, chunk));
      }
      console.log(`  └─ Set '${catName}' for ${ids.length} Keells items.`);
    }
  }

  // 2. Cargills Batch Updates
  if (cargillsSource) {
    console.log("\n🔹 Backfilling Cargills category paths in batches...");
    const cargillsProducts = await db
      .select({ id: products.id, deptCode: products.departmentCode })
      .from(products)
      .where(eq(products.sourceId, cargillsSource.id));

    const grouped: Record<string, string[]> = {};
    for (const p of cargillsProducts) {
      if (p.deptCode && CARGILLS_CAT_MAP[p.deptCode]) {
        const cat = CARGILLS_CAT_MAP[p.deptCode];
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p.id);
      }
    }

    for (const [catName, ids] of Object.entries(grouped)) {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        await db
          .update(products)
          .set({ categoryPath: [catName] })
          .where(inArray(products.id, chunk));
      }
      console.log(`  └─ Set '${catName}' for ${ids.length} Cargills items.`);
    }
  }

  // 3. Arpico Batch Updates
  if (arpicoSource) {
    console.log("\n🔹 Backfilling Arpico category paths in batches...");
    const arpicoProducts = await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(eq(products.sourceId, arpicoSource.id));

    const grouped: Record<string, string[]> = {};
    for (const p of arpicoProducts) {
      const name = p.name.toLowerCase();
      let cat = "Supermarket";
      if (name.includes("milk") || name.includes("cheese") || name.includes("butter") || name.includes("curd") || name.includes("yoghurt")) {
        cat = "Dairy & Chilled";
      } else if (name.includes("apple") || name.includes("banana") || name.includes("carrot") || name.includes("onion") || name.includes("leaf") || name.includes("fruit") || name.includes("veg")) {
        cat = "Fresh Produce";
      } else if (name.includes("rice") || name.includes("flour") || name.includes("dhal") || name.includes("oil") || name.includes("sugar") || name.includes("salt") || name.includes("spice")) {
        cat = "Rice & Grocery";
      } else if (name.includes("biscuit") || name.includes("choco") || name.includes("snack") || name.includes("chips") || name.includes("jelly") || name.includes("cake")) {
        cat = "Snacks & Confectionery";
      } else if (name.includes("soap") || name.includes("shampoo") || name.includes("cream") || name.includes("wash") || name.includes("lotion") || name.includes("toothpaste")) {
        cat = "Personal Care & Beauty";
      } else if (name.includes("tea") || name.includes("coffee") || name.includes("drink") || name.includes("juice") || name.includes("water") || name.includes("soda")) {
        cat = "Beverages";
      } else if (name.includes("chicken") || name.includes("fish") || name.includes("meat") || name.includes("sausage") || name.includes("mutton")) {
        cat = "Meat & Seafood";
      }

      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(p.id);
    }

    for (const [catName, ids] of Object.entries(grouped)) {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        await db
          .update(products)
          .set({ categoryPath: [catName] })
          .where(inArray(products.id, chunk));
      }
      console.log(`  └─ Set '${catName}' for ${ids.length} Arpico items.`);
    }
  }

  console.log("\n🎉 Category path backfill completed successfully!");
}

backfillCategoryPaths()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Backfill failed:", err);
    process.exit(1);
  });
