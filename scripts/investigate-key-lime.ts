import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function investigate() {
  console.log("🔍 Investigating Key Lime Pie ingredient mappings & products...\n");

  const { db } = await import("@/utils/db");
  const { ingredients, mappings, products, priceSources } = await import("@/utils/schema");
  const { sql, ilike, eq } = await import("drizzle-orm");
  const { getBestIngredientMatch } = await import("@/services/ingredientService");

  const queryTerms = [
    "graham cracker",
    "granulated sugar",
    "sugar",
    "sweetened condensed milk",
    "condensed milk",
    "key lime juice",
    "lime juice",
    "lime",
    "egg yolks",
    "egg yolk",
    "egg",
    "heavy cream",
    "cream",
    "powdered sugar",
    "icing sugar",
    "vanilla extract",
    "vanilla",
  ];

  for (const term of queryTerms) {
    // 1. Check ingredients table
    const ings = await db
      .select({ id: ingredients.id, name: ingredients.name, aliases: ingredients.aliases })
      .from(ingredients)
      .where(ilike(ingredients.name, `%${term}%`))
      .limit(3);

    // 2. Check vector match
    const vectorMatch = await getBestIngredientMatch(term);

    // 3. Check products table directly for products containing term
    const prods = await db
      .select({ id: products.id, name: products.name, price: products.price })
      .from(products)
      .where(ilike(products.name, `%${term}%`))
      .limit(3);

    console.log(`=== Term: "${term}" ===`);
    console.log(`  Ingredients DB:`, ings.map(i => `${i.name} (${i.id})`));
    console.log(`  Vector Match:`, vectorMatch);
    console.log(`  Direct Products:`, prods.map(p => `${p.name} - Rs. ${p.price}`));

    // If an ingredient exists, check how many products are mapped to it in `mappings`
    if (ings.length > 0) {
      for (const ing of ings) {
        const mapped = await db
          .select({ count: sql`count(*)` })
          .from(mappings)
          .where(sql`${mappings.matchedIngredients} @> ARRAY[${ing.id}]::uuid[]`);
        console.log(`  Mappings for "${ing.name}":`, mapped[0]?.count);
      }
    }
    console.log("");
  }

  process.exit(0);
}

investigate().catch(e => {
  console.error(e);
  process.exit(1);
});
