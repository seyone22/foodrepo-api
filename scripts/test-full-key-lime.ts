import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function testFullKeyLimePie() {
  const { db } = await import("../src/utils/db");
  const { sql } = await import("drizzle-orm");

  const recipe = [
    { name: "graham cracker crumbs", qty: 180, unit: "g" },
    { name: "unsalted butter", qty: 100, unit: "g" },
    { name: "granulated sugar", qty: 50, unit: "g" },
    { name: "sweetened condensed milk", qty: 792, unit: "g" },
    { name: "key lime juice", qty: 180, unit: "ml" },
    { name: "egg yolks", qty: 4, unit: "unit" },
    { name: "lime or key lime zest", qty: 10, unit: "g" },
    { name: "heavy cream", qty: 240, unit: "ml" },
    { name: "powdered sugar", qty: 40, unit: "g" },
    { name: "vanilla extract", qty: 5, unit: "ml" },
    { name: "lime zest and thinly sliced key limes", qty: 1, unit: "unit" },
  ];

  const SYNONYMS: Record<string, string[]> = {
    "graham cracker crumbs": ["cream cracker", "marie biscuit", "biscuit", "cracker"],
    "graham cracker": ["cream cracker", "marie biscuit", "biscuit", "cracker"],
    "powdered sugar": ["icing sugar", "icing", "sugar"],
    "granulated sugar": ["white sugar", "sugar"],
    "sweetened condensed milk": ["condensed milk", "milkmaid"],
    "key lime juice": ["lime juice", "lime"],
    "lime or key lime zest": ["lime zest", "lime"],
    "lime zest and thinly sliced key limes": ["lime zest", "lime"],
    "heavy cream": ["whipping cream", "cream"],
    "egg yolks": ["egg yolk", "egg"],
    "vanilla extract": ["vanilla essence", "vanilla"],
  };

  console.log("🥧 Testing Multi-Stage Supermarket Resolver for Key Lime Pie:\n");

  let pricedCount = 0;
  let totalCost = 0;

  for (const item of recipe) {
    const clean = item.name.toLowerCase().replace(/[^\w\s]/g, " ").trim();
    const words = clean.split(/\s+/).filter(w => !["or", "and", "thinly", "sliced", "crumbs", "taste", "optional"].includes(w));

    const candidates = [
      clean,
      ...(SYNONYMS[clean] || []),
      ...(words.length > 1 ? [words.slice(1).join(" "), words.join(" ")] : []),
      words[words.length - 1],
    ];

    const uniqueCandidates = [...new Set(candidates.filter(c => c && c.length >= 3))];

    // Query for mapped products
    let bestProduct: any = null;
    let matchedIngName = "";

    for (const cand of uniqueCandidates) {
      // 1. Search products via mapped ingredient name
      const res = await db.execute(sql`
        SELECT 
          i.id as ingredient_id,
          i.name as ingredient_name,
          p.id as product_id,
          p.name as product_name,
          p.price as price,
          ps.name as store_name
        FROM foodrepo.ingredients i
        JOIN foodrepo.mappings m ON i.id = ANY(m.matched_ingredients)
        JOIN foodrepo.products p ON p.id = m.product_id
        JOIN foodrepo.price_sources ps ON ps.id = p.source_id
        WHERE lower(i.name) = ${cand}
        ORDER BY p.price ASC
        LIMIT 1;
      `);

      if ((res as any).length > 0) {
        bestProduct = (res as any)[0];
        matchedIngName = bestProduct.ingredient_name;
        break;
      }
    }

    // 2. If not found via ingredient, search product name directly
    if (!bestProduct) {
      for (const cand of uniqueCandidates) {
        const res = await db.execute(sql`
          SELECT 
            p.id as product_id,
            p.name as product_name,
            p.price as price,
            ps.name as store_name,
            i.name as ingredient_name,
            i.id as ingredient_id
          FROM foodrepo.products p
          JOIN foodrepo.price_sources ps ON ps.id = p.source_id
          LEFT JOIN foodrepo.mappings m ON m.product_id = p.id
          LEFT JOIN foodrepo.ingredients i ON i.id = m.matched_ingredients[1]
          WHERE lower(p.name) ILIKE ${'%' + cand + '%'}
          ORDER BY p.price ASC
          LIMIT 1;
        `);

        if ((res as any).length > 0) {
          bestProduct = (res as any)[0];
          matchedIngName = bestProduct.ingredient_name || cand;
          break;
        }
      }
    }

    if (bestProduct) {
      pricedCount++;
      totalCost += bestProduct.price;
      console.log(`✅ [PRICED] "${item.name}" (${item.qty} ${item.unit})`);
      console.log(`   -> Product: "${bestProduct.product_name}"`);
      console.log(`   -> Supermarket: ${bestProduct.store_name} | Price: Rs. ${bestProduct.price}`);
      console.log(`   -> Canonical DB Ingredient: "${matchedIngName}"\n`);
    } else {
      console.log(`❌ [UNPRICED] "${item.name}"\n`);
    }
  }

  console.log(`=============================================`);
  console.log(`Priced: ${pricedCount} / ${recipe.length} ingredients!`);
  console.log(`Sample Basket Total: Rs. ${totalCost.toFixed(2)}`);
  process.exit(0);
}

testFullKeyLimePie().catch(console.error);
