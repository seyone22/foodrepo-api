import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/utils/db");
  const { ingredients, mappings, products, priceSources } = await import("../src/utils/schema");
  const { sql } = await import("drizzle-orm");

  const terms = ["sugar", "condensed milk", "lime", "egg", "cream", "vanilla", "cracker", "biscuit"];

  for (const term of terms) {
    console.log(`\n================ KEYWORD: "${term}" ================`);
    const mapped = await db.execute(sql`
      SELECT 
        i.id as ingredient_id,
        i.name as ingredient_name,
        p.name as product_name,
        p.price as product_price,
        ps.name as source_name
      FROM foodrepo.mappings m
      JOIN foodrepo.products p ON p.id = m.product_id
      JOIN foodrepo.price_sources ps ON ps.id = p.source_id
      JOIN foodrepo.ingredients i ON i.id = ANY(m.matched_ingredients)
      WHERE i.name ILIKE ${'%' + term + '%'} OR p.name ILIKE ${'%' + term + '%'}
      LIMIT 4;
    `);

    for (const row of mapped as any) {
      console.log(`  Ing: "${row.ingredient_name}" -> Product: "${row.product_name}" (${row.source_name}: Rs. ${row.product_price})`);
    }
    if ((mapped as any).length === 0) {
      console.log("  (No mapped products found)");
    }
  }

  process.exit(0);
}

main().catch(console.error);
