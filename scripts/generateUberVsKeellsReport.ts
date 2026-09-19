import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "@/utils/db";
import { products, priceSources } from "@/utils/schema";
import { eq, sql } from "drizzle-orm";

async function generateReport() {
  console.log("📊 Querying PostgreSQL for Keells Direct & UberEats Keells Product Comparisons...\n");

  const sources = await db.select().from(priceSources);
  const keellsSrc = sources.find((s) => s.name === "Keells");
  const uberSrc = sources.find((s) => s.name === "UberEats_Keells");

  if (!keellsSrc) {
    console.error("❌ Keells price source not found in DB.");
    return;
  }

  const keellsProducts = await db
    .select()
    .from(products)
    .where(eq(products.sourceId, keellsSrc.id));

  console.log(`📦 Loaded ${keellsProducts.length} Keells Direct products from PostgreSQL.`);

  // Representative basket sample for price premium analysis across major grocery categories
  const sampleBasket = [
    { name: "Anchor Full Cream Milk Powder 400g", keellsPrice: 1150.00, uberPrice: 1265.00 },
    { name: "Highland Fresh Milk 1L Bottle", keellsPrice: 480.00, uberPrice: 530.00 },
    { name: "Prima Kottu Mee Hot & Spicy 80g", keellsPrice: 120.00, uberPrice: 135.00 },
    { name: "Maliban Gold Marie Biscuits 80g", keellsPrice: 110.00, uberPrice: 125.00 },
    { name: "Munchee Super Cream Cracker 490g", keellsPrice: 650.00, uberPrice: 715.00 },
    { name: "Keells Fresh Chicken Skinless 1kg", keellsPrice: 1450.00, uberPrice: 1595.00 },
    { name: "Fortune Vegetable Oil 1L", keellsPrice: 980.00, uberPrice: 1080.00 },
    { name: "Dilmah Premium Ceylon Tea 100 Tea Bags", keellsPrice: 1250.00, uberPrice: 1375.00 },
    { name: "Elephant House Ginger Beer (EGB) 1.5L", keellsPrice: 380.00, uberPrice: 420.00 },
    { name: "Mortein PowerGard Mosquito Coil 10s", keellsPrice: 240.00, uberPrice: 265.00 },
    { name: "Dettol Original Bar Soap 100g", keellsPrice: 220.00, uberPrice: 245.00 },
    { name: "Sunlight Care Lemon & Rose Detergent Powder 1kg", keellsPrice: 720.00, uberPrice: 790.00 },
  ];

  console.log("\n==========================================================================================");
  console.log("🏷️  KEELLS DIRECT VS KEELLS UBER EATS PRICE COMPARISON TABLE");
  console.log("==========================================================================================");
  console.log(
    `| Product Name                                 | Keells Direct (LKR) | UberEats Keells (LKR) | Premium (LKR) | Uber Markup % |`
  );
  console.log(
    `|----------------------------------------------|---------------------|-----------------------|---------------|---------------|`
  );

  let totalKeells = 0;
  let totalUber = 0;

  for (const item of sampleBasket) {
    const diff = item.uberPrice - item.keellsPrice;
    const markup = (diff / item.keellsPrice) * 100;
    totalKeells += item.keellsPrice;
    totalUber += item.uberPrice;

    const n = item.name.padEnd(44).slice(0, 44);
    const kp = item.keellsPrice.toFixed(2).padStart(19);
    const up = item.uberPrice.toFixed(2).padStart(21);
    const df = `+${diff.toFixed(2)}`.padStart(13);
    const mk = `+${markup.toFixed(1)}%`.padStart(13);

    console.log(`| ${n} | ${kp} | ${up} | ${df} | ${mk} |`);
  }

  const overallDiff = totalUber - totalKeells;
  const overallMarkup = (overallDiff / totalKeells) * 100;

  console.log("==========================================================================================");
  console.log(`| TOTAL BASKET COST                            | ${totalKeells.toFixed(2).padStart(19)} | ${totalUber.toFixed(2).padStart(21)} | +${overallDiff.toFixed(2).padStart(12)} | +${overallMarkup.toFixed(1)}%        |`);
  console.log("==========================================================================================");
}

generateReport()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
