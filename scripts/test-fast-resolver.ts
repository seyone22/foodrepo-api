import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/utils/db");
  const { sql } = await import("drizzle-orm");

  // A fast, efficient candidate resolver
  async function resolveIngredient(rawName: string) {
    const clean = rawName.toLowerCase().replace(/[^\w\s]/g, " ").trim();
    
    // 1. Synonym dictionary for common Western recipe terms to Sri Lankan supermarket conventions
    const SYNONYMS: Record<string, string[]> = {
      "graham cracker crumbs": ["graham cracker", "cream cracker", "marie biscuit", "biscuit"],
      "graham cracker": ["cream cracker", "marie biscuit", "biscuit"],
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

    // Build ordered search candidates
    const searchTerms: string[] = [];
    if (SYNONYMS[clean]) searchTerms.push(...SYNONYMS[clean]);
    searchTerms.push(clean);

    // Also extract word n-grams (e.g. "condensed milk" from "sweetened condensed milk")
    const words = clean.split(/\s+/).filter(w => !["or", "and", "thinly", "sliced", "crumbs", "taste", "optional"].includes(w));
    if (words.length > 1) {
      searchTerms.push(words.slice(1).join(" ")); // "condensed milk"
      searchTerms.push(words[words.length - 1]);   // "milk"
    }

    const uniqueCandidates = [...new Set(searchTerms.filter(t => t.length > 2))];

    for (const cand of uniqueCandidates) {
      // Find an ingredient that actually HAS products mapped to it
      const res = await db.execute(sql`
        SELECT 
          i.id as ingredient_id,
          i.name as ingredient_name,
          p.name as sample_product,
          p.price as sample_price,
          ps.name as sample_store
        FROM foodrepo.ingredients i
        JOIN foodrepo.mappings m ON i.id = ANY(m.matched_ingredients)
        JOIN foodrepo.products p ON p.id = m.product_id
        JOIN foodrepo.price_sources ps ON ps.id = p.source_id
        WHERE lower(i.name) = ${cand}
        LIMIT 1;
      `);

      if ((res as any).length > 0) {
        return (res as any)[0];
      }
    }

    // Fallback: ILIKE match on ingredients that have mapped products
    for (const cand of uniqueCandidates) {
      const res = await db.execute(sql`
        SELECT 
          i.id as ingredient_id,
          i.name as ingredient_name,
          p.name as sample_product,
          p.price as sample_price,
          ps.name as sample_store
        FROM foodrepo.ingredients i
        JOIN foodrepo.mappings m ON i.id = ANY(m.matched_ingredients)
        JOIN foodrepo.products p ON p.id = m.product_id
        JOIN foodrepo.price_sources ps ON ps.id = p.source_id
        WHERE lower(i.name) ILIKE ${'%' + cand + '%'}
        LIMIT 1;
      `);

      if ((res as any).length > 0) {
        return (res as any)[0];
      }
    }

    return null;
  }

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

  console.log("Testing Fast Smart Resolver on all 11 ingredients:\n");
  for (const term of recipeTerms) {
    const match = await resolveIngredient(term);
    if (match) {
      console.log(`✅ "${term}" -> Matched: "${match.ingredient_name}"`);
      console.log(`   Sample Product: "${match.sample_product}" at ${match.sample_store} (Rs. ${match.sample_price})\n`);
    } else {
      console.log(`❌ "${term}" -> Not matched\n`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
