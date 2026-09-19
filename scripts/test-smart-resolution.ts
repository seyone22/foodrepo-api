import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function testResolution() {
  const { db } = await import("../src/utils/db");
  const { sql } = await import("drizzle-orm");

  const recipeTerms = [
    "graham cracker crumbs",
    "unsalted butter",
    "granulated sugar",
    "sweetened condensed milk",
    "key lime juice",
    "egg yolks",
    "lime or key lime zest",
    "heavy cream",
    "powdered sugar",
    "vanilla extract",
    "lime zest and thinly sliced key limes",
  ];

  console.log("Testing Smart Ingredient & Product Matcher...\n");

  for (const rawName of recipeTerms) {
    // Generate candidate tokens: full name, simplified terms
    const clean = rawName.toLowerCase().replace(/[^\w\s]/g, " ").trim();
    const words = clean.split(/\s+/).filter(w => !["or", "and", "thinly", "sliced", "crumbs", "taste", "optional"].includes(w));

    // Form search phrases from longest to shortest
    const candidates = [
      clean,
      words.join(" "),
      // special culinary synonyms
      ...(clean.includes("graham") ? ["graham cracker", "cream cracker", "marie biscuit", "biscuit"] : []),
      ...(clean.includes("condensed milk") ? ["condensed milk", "milkmaid"] : []),
      ...(clean.includes("powdered sugar") ? ["icing sugar", "icing", "sugar"] : []),
      ...(clean.includes("heavy cream") ? ["whipping cream", "cream"] : []),
      ...(clean.includes("lime") ? ["lime juice", "lime"] : []),
      ...(clean.includes("egg") ? ["egg"] : []),
      ...(clean.includes("vanilla") ? ["vanilla extract", "vanilla essence", "vanilla"] : []),
      ...(clean.includes("sugar") ? ["white sugar", "sugar"] : []),
      ...(clean.includes("butter") ? ["unsalted butter", "butter"] : []),
    ];

    let foundOffer: any = null;

    for (const cand of [...new Set(candidates)]) {
      const q = await db.execute(sql`
        SELECT 
          i.id as ingredient_id,
          i.name as ingredient_name,
          p.name as product_name,
          p.price as price,
          ps.name as store_name
        FROM foodrepo.mappings m
        JOIN foodrepo.products p ON p.id = m.product_id
        JOIN foodrepo.price_sources ps ON ps.id = p.source_id
        JOIN foodrepo.ingredients i ON i.id = ANY(m.matched_ingredients)
        WHERE 
          lower(i.name) = ${cand}
          OR lower(p.name) ILIKE ${'%' + cand + '%'}
          OR lower(i.name) ILIKE ${'%' + cand + '%'}
        ORDER BY 
          CASE WHEN lower(i.name) = ${cand} THEN 1 ELSE 2 END,
          p.price ASC
        LIMIT 1;
      `);

      if ((q as any).length > 0) {
        foundOffer = (q as any)[0];
        break;
      }
    }

    if (foundOffer) {
      console.log(`✅ "${rawName}":`);
      console.log(`   -> Product: "${foundOffer.product_name}" at ${foundOffer.store_name} (Rs. ${foundOffer.price})`);
      console.log(`   -> Canonical DB Ingredient: "${foundOffer.ingredient_name}"\n`);
    } else {
      console.log(`❌ "${rawName}": No mapped product found.\n`);
    }
  }

  process.exit(0);
}

testResolution().catch(console.error);
