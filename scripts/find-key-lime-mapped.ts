import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/utils/db");
  const { ingredients, mappings, products, priceSources } = await import("../src/utils/schema");
  const { sql } = await import("drizzle-orm");

  const recipeIngredients = [
    { query: "graham cracker crumbs", candidates: ["graham", "cracker", "marie", "biscuit"] },
    { query: "unsalted butter", candidates: ["butter"] },
    { query: "granulated sugar", candidates: ["sugar", "white sugar"] },
    { query: "sweetened condensed milk", candidates: ["condensed milk", "milkmaid"] },
    { query: "key lime juice", candidates: ["lime juice", "lime"] },
    { query: "egg yolks", candidates: ["egg yolk", "egg"] },
    { query: "lime or key lime zest", candidates: ["lime zest", "lime"] },
    { query: "heavy cream", candidates: ["heavy cream", "whipping cream", "cream"] },
    { query: "powdered sugar", candidates: ["powdered sugar", "icing sugar", "icing"] },
    { query: "vanilla extract", candidates: ["vanilla extract", "vanilla essence", "vanilla"] },
  ];

  for (const item of recipeIngredients) {
    console.log(`\n==================================================`);
    console.log(`Searching for: "${item.query}"`);
    console.log(`Candidate words:`, item.candidates);

    // Search directly for mapped products matching any candidate
    for (const cand of item.candidates) {
      const res = await db.execute(sql`
        SELECT 
          i.id as ingredient_id,
          i.name as ingredient_name,
          p.name as product_name,
          p.price as price,
          ps.name as store
        FROM foodrepo.mappings m
        JOIN foodrepo.products p ON p.id = m.product_id
        JOIN foodrepo.price_sources ps ON ps.id = p.source_id
        JOIN foodrepo.ingredients i ON i.id = ANY(m.matched_ingredients)
        WHERE i.name ILIKE ${'%' + cand + '%'} OR p.name ILIKE ${'%' + cand + '%'}
        LIMIT 2;
      `);

      if ((res as any).length > 0) {
        console.log(`  Found via candidate "${cand}":`);
        for (const r of res as any) {
          console.log(`    -> [${r.store}] ${r.product_name} - Rs. ${r.price} (mapped to ingredient: "${r.ingredient_name}")`);
        }
        break;
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
