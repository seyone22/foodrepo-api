import { desc, eq, inArray, sql } from "drizzle-orm";
import type {
  AggregateOffer,
  HowToSupply,
  Offer,
  PricingStrategy,
  RecipePricingOptions,
  SchemaOrgRecipe,
  StoreBreakdown,
} from "./dto/recipePricing.dto";
import { db } from "@/database/database.module";
import { normalizeQuantityUnit } from "@/common/utils/normalize-qty.util";
import {
  ingredients,
  mappings,
  priceHistories,
  priceSources,
  products,
} from "@/database/schema";
import { toPgId } from "@/common/utils/uuid.util";

// ---------------------------------------------------------------------------
// Unit Conversion Helpers
// ---------------------------------------------------------------------------

interface StandardizedQty {
  qty: number;
  unit: "g" | "ml" | "unit";
}

function toBaseUnit(qty: number, rawUnit?: string): StandardizedQty {
  const u = (rawUnit || "").toLowerCase().trim();

  // Mass -> grams
  if (["g", "gram", "grams"].includes(u)) {
    return { qty, unit: "g" };
  }
  if (["kg", "kilogram", "kilograms"].includes(u)) {
    return { qty: qty * 1000, unit: "g" };
  }
  if (["mg", "milligram", "milligrams"].includes(u)) {
    return { qty: qty / 1000, unit: "g" };
  }

  // Volume -> ml
  if (["ml", "milliliter", "milliliters"].includes(u)) {
    return { qty, unit: "ml" };
  }
  if (["l", "liter", "liters", "litre", "litres"].includes(u)) {
    return { qty: qty * 1000, unit: "ml" };
  }
  if (["tbsp", "tablespoon", "tablespoons"].includes(u)) {
    return { qty: qty * 15, unit: "ml" };
  }
  if (["tsp", "teaspoon", "teaspoons"].includes(u)) {
    return { qty: qty * 5, unit: "ml" };
  }
  if (["cup", "cups"].includes(u)) {
    return { qty: qty * 240, unit: "ml" };
  }

  // Count / discrete units
  return { qty, unit: "unit" };
}

function parseServingCount(raw?: number | string): number {
  if (typeof raw === "number" && !Number.isNaN(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const match = raw.match(/\d+(\.\d+)?/);
    if (match) {
      const parsed = parseFloat(match[0]);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Main Recipe Pricing Engine Service
// ---------------------------------------------------------------------------

export async function evaluateRecipePricing(
  recipe: SchemaOrgRecipe,
  options: RecipePricingOptions = {},
): Promise<SchemaOrgRecipe> {
  const originalServings = parseServingCount(recipe.recipeYield);
  const targetServings = options.servings
    ? parseServingCount(options.servings)
    : originalServings;
  const scaleFactor = targetServings / originalServings;

  const strategy: PricingStrategy = options.strategy || "cheapest";
  const excludeList = new Set(
    (options.exclude || []).map((e) => e.toLowerCase().trim()),
  );
  const allowedSources = options.sources?.length
    ? options.sources.map((s) => s.toLowerCase().trim())
    : null;

  // Track store subtotals for storeBreakdown
  const storeStats: Record<
    string,
    {
      storeName: string;
      itemCount: number;
      recipeSubtotal: number;
      basketSubtotal: number;
      missingItems: string[];
    }
  > = {};

  const enrichedIngredients: HowToSupply[] = [];

  // Temporary list to support "cheapest_single_store" analysis
  interface IngredientEvaluation {
    supply: HowToSupply;
    offers: Offer[];
    requiredQty: number;
    requiredUnit: string;
    isExcluded: boolean;
  }
  const evaluations: IngredientEvaluation[] = [];

  // 1️⃣ First pass: Resolve canonical ingredients & fetch all candidate store offers
  for (const rawSupply of recipe.recipeIngredient) {
    const supplyName = rawSupply.name?.trim() || "";
    const isExcluded =
      !supplyName ||
      excludeList.has(supplyName.toLowerCase()) ||
      (rawSupply.identifier &&
        excludeList.has(rawSupply.identifier.toLowerCase()));

    // Scale ingredient quantity
    const originalQty = rawSupply.requiredQuantity?.value ?? 1;
    const scaledQty = Math.round(originalQty * scaleFactor * 100) / 100;
    const unitText = rawSupply.requiredQuantity?.unitText || "unit";

    const baseSupply: HowToSupply = {
      "@type": "HowToSupply",
      name: supplyName,
      identifier: rawSupply.identifier || null,
      requiredQuantity: {
        "@type": "QuantitativeValue",
        value: scaledQty,
        unitText,
      },
      offers: [],
      status: isExcluded ? "excluded" : "unpriced",
    };

    if (isExcluded) {
      baseSupply.note = "Excluded by user options";
      enrichedIngredients.push(baseSupply);
      continue;
    }

    // -----------------------------------------------------------------------
    // Multi-Stage Ingredient & Supermarket Product Resolver
    // -----------------------------------------------------------------------
    let resolvedId: string | null = null;
    let mappedData: Array<{
      product: typeof products.$inferSelect;
      source: typeof priceSources.$inferSelect | null;
    }> = [];
    const clean = (supplyName || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .trim();

    // Helper: Context-aware food & culinary product filter
    const isFoodProduct = (prodName: string, catPath?: string[] | null) => {
      const lower = prodName.toLowerCase();
      const nonFoodKeywords = [
        "face cream",
        "lip care",
        "air freshener",
        "body lotion",
        "hand wash",
        "body wash",
        "shampoo",
        "conditioner",
        "soap",
        "detergent",
        "dishwash",
        "cleanser",
        "mosquito",
        "coloring",
        "colouring",
      ];
      for (const bad of nonFoodKeywords) {
        if (lower.includes(bad) && !clean.includes(bad)) return false;
      }
      if (
        catPath?.some((c) =>
          /household|beauty|personal|cleaning|laundry/i.test(c),
        )
      ) {
        return false;
      }

      // Ingredient-specific context filtering:
      // 1. Egg / Egg yolks (exclude prepared meals/bakery snacks/mayo)
      if (clean.includes("egg")) {
        const nonRawEggWords = [
          "bun",
          "paan",
          "bread",
          "roti",
          "noodle",
          "roll",
          "pastry",
          "sandwich",
          "kottu",
          "curry",
          "jam",
          "biscuit",
          "savoury",
          "bakery",
          "short eat",
          "mayonnaise",
          "sauce",
          "dip",
        ];
        if (nonRawEggWords.some((w) => lower.includes(w))) return false;
        if (catPath?.some((c) => /bakery|savoury|restaurant|meals/i.test(c))) {
          return false;
        }
      }

      // 2. Heavy Cream / Whipping Cream (exclude biscuits/crackers/sodas)
      if (clean.includes("cream")) {
        const nonDairyCreamWords = [
          "soda",
          "drink",
          "beverage",
          "cracker",
          "biscuit",
          "sandwich",
          "wafer",
          "ice cream",
          "i/c",
          "shaving",
          "custard",
          "tart",
          "cake",
          "puff",
          "bun",
          "dessert",
        ];
        if (nonDairyCreamWords.some((w) => lower.includes(w))) return false;
      }

      // 3. Vanilla Extract / Essence (exclude vanilla ice creams/milks/wafers)
      if (clean.includes("vanilla")) {
        const nonExtractWords = [
          "ice cream",
          "i/c",
          "bar",
          "cone",
          "milk",
          "supplement",
          "biscuit",
          "wafer",
          "yoghurt",
          "cake",
          "tea",
          "drink",
        ];
        if (nonExtractWords.some((w) => lower.includes(w))) return false;
      }

      // 4. Lime / Lemon / Juices (exclude iced teas like Twistee, sodas, crushes, energy drinks)
      if (
        clean.includes("lime") ||
        clean.includes("lemon") ||
        clean.includes("juice")
      ) {
        const nonCulinaryJuiceWords = [
          "tea",
          "iced tea",
          "twistee",
          "pickle",
          "chutney",
          "drink",
          "soda",
          "energy",
          "cordial",
          "crush",
          "squash",
          "powder",
          "oil",
          "dish wash",
          "soap",
          "puff",
          "biscuit",
          "wafer",
          "cookie",
          "cake",
          "confectionery",
          "chocolate",
          "dessert",
          "shampoo",
          "sunquick",
          "sauce",
          "mustard",
          "mayo",
          "dressing",
          "dip",
          "marinade",
          "grass",
          "lemongrass",
        ];
        if (nonCulinaryJuiceWords.some((w) => lower.includes(w))) return false;

        // Fruit fidelity check: if recipe specifies apple juice, product must contain apple
        if (clean.includes("apple") && !lower.includes("apple")) return false;
        if (clean.includes("lemon") && !lower.includes("lemon")) return false;
        if (clean.includes("lime") && !lower.includes("lime")) return false;
        if (clean.includes("orange") && !lower.includes("orange")) return false;
        if (clean.includes("pineapple") && !lower.includes("pineapple"))
          return false;
        if (clean.includes("grape") && !lower.includes("grape")) return false;
      }

      // 5. Milk (exclude chocolate, biscuits, confectionery)
      if (
        clean === "milk" ||
        (clean.includes("milk") &&
          !clean.includes("chocolate") &&
          !clean.includes("condensed"))
      ) {
        const nonFreshMilkWords = [
          "chocolate",
          "choco",
          "biscuit",
          "cookie",
          "candy",
          "toffee",
          "ice cream",
          "bar",
          "soap",
          "wash",
          "shampoo",
          "wafer",
          "malt",
          "ritzbury",
          "kandos",
          "revello",
        ];
        if (nonFreshMilkWords.some((w) => lower.includes(w))) return false;
        if (
          catPath?.some((c) => /confectionery|chocolate|biscuit|sweet/i.test(c))
        ) {
          return false;
        }
      }

      // 6. Garlic (exclude sauces, snacks, cashew, popcorn, mixture)
      if (clean.includes("garlic")) {
        const nonFreshGarlicWords = [
          "sauce",
          "paste",
          "pickle",
          "cashew",
          "nut",
          "popcorn",
          "snack",
          "bites",
          "mixture",
          "cracker",
          "bread",
          "butter",
          "mayo",
          "dip",
          "chips",
        ];
        if (nonFreshGarlicWords.some((w) => lower.includes(w))) return false;
      }

      // 7. Pepper / Black Pepper (exclude flavored snacks, nuts, and bell pepper vegetables)
      if (clean.includes("pepper")) {
        const nonSpicePepperWords = [
          "almond",
          "cashew",
          "nut",
          "snack",
          "chips",
          "cracker",
          "biscuit",
          "sauce",
          "chicken",
          "sausage",
          "devilled",
          "bites",
        ];
        if (nonSpicePepperWords.some((w) => lower.includes(w))) return false;
        // If asking for black pepper or spice pepper, reject fresh bell peppers / capsicums
        if (clean.includes("black pepper") || !clean.includes("bell")) {
          if (
            lower.includes("bell pepper") ||
            lower.includes("capsicum") ||
            catPath?.some((c) => /vegetable|fruit/i.test(c))
          ) {
            return false;
          }
        }
      }

      // 8. Chicken Meat (exclude eggs, hatchery, sausages, nuggets)
      if (clean.includes("chicken")) {
        if (!clean.includes("egg")) {
          if (lower.includes("egg") || catPath?.some((c) => /egg/i.test(c))) {
            return false;
          }
        }
        // Specific cut check: if chicken breast requested, require breast
        if (clean.includes("breast") && !lower.includes("breast")) {
          return false;
        }
        const nonFreshChickenWords = [
          "sausage",
          "nugget",
          "curry",
          "cube",
          "seasoning",
          "flavour",
          "flavor",
          "noodle",
          "chips",
          "biscuit",
          "bun",
          "patty",
          "roll",
        ];
        if (nonFreshChickenWords.some((w) => lower.includes(w))) return false;
      }

      // 9. Flour / All-purpose flour (exclude whole wheat atta or cleaning bleach)
      if (
        clean.includes("all purpose flour") ||
        clean.includes("plain flour")
      ) {
        const nonAllPurposeFlourWords = [
          "atta",
          "bleach",
          "kurakkan",
          "corn",
          "rice",
        ];
        if (nonAllPurposeFlourWords.some((w) => lower.includes(w)))
          return false;
      }

      // 10. Onion (exclude rings, sambol, snacks)
      if (clean.includes("onion")) {
        const nonFreshOnionWords = [
          "ring",
          "chips",
          "cracker",
          "sambol",
          "sauce",
          "paste",
          "bites",
        ];
        if (nonFreshOnionWords.some((w) => lower.includes(w))) return false;
      }

      // 11. Fresh Tomatoes (exclude puree, paste, ketchup, sauces, snacks)
      if (
        clean.includes("tomato") &&
        !clean.includes("puree") &&
        !clean.includes("paste")
      ) {
        const nonFreshTomatoWords = [
          "puree",
          "paste",
          "ketchup",
          "sauce",
          "chips",
          "snack",
          "soap",
          "tetos",
          "ramba",
          "bites",
          "cracker",
          "biscuit",
          "cbl",
          "extruded",
        ];
        if (nonFreshTomatoWords.some((w) => lower.includes(w))) return false;
      }

      return true;
    };

    // Stage 1: Explicit identifier provided
    if (rawSupply.identifier) {
      try {
        const pgId = toPgId(rawSupply.identifier);
        const existing = await db.query.ingredients.findFirst({
          where: eq(ingredients.id, pgId),
          columns: { id: true, name: true },
        });
        if (existing) {
          resolvedId = existing.id;
          baseSupply.identifier = existing.id;
          const rows = await db
            .select({ product: products, source: priceSources })
            .from(mappings)
            .innerJoin(products, eq(products.id, mappings.productId))
            .leftJoin(priceSources, eq(priceSources.id, products.sourceId))
            .where(
              sql`${mappings.matchedIngredients} @> ARRAY[${pgId}]::uuid[]`,
            );
          mappedData = rows.filter((r) =>
            isFoodProduct(r.product.name, r.product.categoryPath),
          );
        }
      } catch {
        // Fallback to name resolution
      }
    }

    // Stage 2: Resolve via culinary synonyms & mapped ingredients
    if (mappedData.length === 0 && supplyName) {
      const SYNONYMS: Record<string, string[]> = {
        "graham cracker crumbs": [
          "cream cracker",
          "marie biscuit",
          "biscuit",
          "cracker",
        ],
        "graham cracker": [
          "cream cracker",
          "marie biscuit",
          "biscuit",
          "cracker",
        ],
        "powdered sugar": ["icing sugar", "icing", "sugar"],
        "granulated sugar": ["white sugar", "sugar"],
        "sweetened condensed milk": ["condensed milk", "milkmaid"],
        "key lime juice": ["lime juice", "lime"],
        "lime or key lime zest": ["lime"],
        "lime zest and thinly sliced key limes": ["lime"],
        "heavy cream": ["whipping cream", "heavy cream", "cooking cream"],
        "egg yolks": ["eggs", "egg"],
        eggs: ["eggs", "egg"],
        "vanilla extract": [
          "vanilla essence",
          "vanilla extract",
          "vanilla flavour",
        ],
        "all purpose flour": [
          "plain flour",
          "all purpose flour",
          "wheat flour",
        ],
        "plain flour": ["plain flour", "all purpose flour", "wheat flour"],
        "apple juice": ["apple juice", "apple nectar"],
        "lemon juice": ["lemon juice", "lemon", "fresh lemon"],
        "black pepper": ["black pepper", "pepper powder", "peppercorns"],
        milk: ["fresh milk", "uht milk", "full cream milk", "milk"],
        garlic: ["garlic 1kg", "garlic", "fresh garlic"],
        onion: ["big onion", "red onion", "onion"],
        tomatoes: ["tomatoes", "tomato", "tomato (kg)"],
        "chicken breast": [
          "chicken breast",
          "chicken breast bone-in",
          "chicken breast skinless",
        ],
        "olive oil": ["olive oil", "extra virgin olive oil"],
      };

      const GENERIC_FOOD_NOUNS = new Set([
        "juice",
        "oil",
        "flour",
        "sauce",
        "powder",
        "extract",
        "essence",
        "seeds",
        "paste",
        "syrup",
        "water",
        "drink",
        "leaves",
        "pieces",
        "slices",
        "crush",
        "curry",
        "snack",
        "mix",
        "puree",
        "cream",
        "yolks",
        "bar",
        "breast",
        "cut",
      ]);

      const words = clean
        .split(/\s+/)
        .filter(
          (w) =>
            ![
              "or",
              "and",
              "thinly",
              "sliced",
              "crumbs",
              "taste",
              "optional",
            ].includes(w),
        );
      const candidates = [
        clean,
        ...(SYNONYMS[clean] || []),
        ...(words.length > 1
          ? [words.slice(1).join(" "), words.join(" ")].filter(
              (w) => !GENERIC_FOOD_NOUNS.has(w),
            )
          : []),
        ...(!GENERIC_FOOD_NOUNS.has(words[words.length - 1])
          ? [words[words.length - 1]]
          : []),
      ];
      const uniqueCandidates = [
        ...new Set(
          candidates.filter(
            (c) => c && c.length >= 3 && !GENERIC_FOOD_NOUNS.has(c),
          ),
        ),
      ];

      for (const cand of uniqueCandidates) {
        // Query ingredient that has mapped products
        const candidateRows = await db
          .select({
            product: products,
            source: priceSources,
            ingredientId: sql<string>`${ingredients.id}::text`,
            ingredientName: ingredients.name,
          })
          .from(ingredients)
          .innerJoin(
            mappings,
            sql`${ingredients.id} = ANY(${mappings.matchedIngredients})`,
          )
          .innerJoin(products, eq(products.id, mappings.productId))
          .leftJoin(priceSources, eq(priceSources.id, products.sourceId))
          .where(sql`lower(${ingredients.name}) = ${cand}`)
          .limit(20);

        const validFoodRows = candidateRows.filter((r) =>
          isFoodProduct(r.product.name, r.product.categoryPath),
        );
        if (validFoodRows.length > 0) {
          mappedData = validFoodRows.map((r) => ({
            product: r.product,
            source: r.source,
          }));
          resolvedId = validFoodRows[0].ingredientId;
          baseSupply.identifier = resolvedId;
          break;
        }
      }

      // Stage 3: Direct food product search fallback
      if (mappedData.length === 0) {
        for (const cand of uniqueCandidates) {
          const directRows = await db
            .select({
              product: products,
              source: priceSources,
              ingredientId: sql<string>`${mappings.matchedIngredients}[1]::text`,
            })
            .from(products)
            .leftJoin(priceSources, eq(priceSources.id, products.sourceId))
            .leftJoin(mappings, eq(mappings.productId, products.id))
            .where(sql`lower(${products.name}) ILIKE ${`%${cand}%`}`)
            .limit(20);

          const validDirectRows = directRows.filter((r) =>
            isFoodProduct(r.product.name, r.product.categoryPath),
          );
          if (validDirectRows.length > 0) {
            mappedData = validDirectRows.map((r) => ({
              product: r.product,
              source: r.source,
            }));
            if (validDirectRows[0].ingredientId) {
              resolvedId = validDirectRows[0].ingredientId;
              baseSupply.identifier = resolvedId;
            }
            break;
          }
        }
      }
    }

    // Filter by allowed sources
    const filteredMapped = allowedSources
      ? mappedData.filter((m) => {
          const sName = m.source?.name?.toLowerCase();
          return sName && allowedSources.includes(sName);
        })
      : mappedData;

    if (filteredMapped.length === 0) {
      baseSupply.status = "unpriced";
      baseSupply.note = "No products found in selected supermarkets";
      enrichedIngredients.push(baseSupply);
      continue;
    }

    const productIds = filteredMapped.map((m) => m.product.id);

    // Fetch latest price history for each product (with fallback to product.price on transient error)
    let latestPrices: Array<{
      productId: string;
      latestPrice: number;
      currency: string | null;
      lastUpdated: Date;
    }> = [];
    try {
      latestPrices = await db
        .selectDistinctOn([priceHistories.productId], {
          productId: priceHistories.productId,
          latestPrice: priceHistories.price,
          currency: priceHistories.currency,
          lastUpdated: priceHistories.timestamp,
        })
        .from(priceHistories)
        .where(inArray(priceHistories.productId, productIds))
        .orderBy(priceHistories.productId, desc(priceHistories.timestamp));
    } catch {
      // Fallback to product.price directly
    }

    const priceMap = new Map(latestPrices.map((p) => [p.productId, p]));

    // Compute costs for each product offer
    const ingredientReqBase = toBaseUnit(scaledQty, unitText);
    const candidateOffers: Offer[] = [];

    for (const { product, source } of filteredMapped) {
      const priceRecord = priceMap.get(product.id);
      const unitPrice = priceRecord ? priceRecord.latestPrice : product.price;
      const currency = priceRecord?.currency || product.currency || "LKR";

      // Normalize package size
      let normalizedPkg = { quantity: 1, unit: "unit" };
      try {
        normalizedPkg = normalizeQuantityUnit({
          name: product.name,
          unit: product.unit,
          quantity: product.quantity,
        });
      } catch {
        normalizedPkg = {
          quantity: product.quantity || 1,
          unit: product.unit || "unit",
        };
      }

      const productPkgBase = toBaseUnit(
        normalizedPkg.quantity,
        normalizedPkg.unit,
      );

      // Cost calculation
      let packsNeeded = 1;
      let recipeCost = unitPrice;
      let basketCost = unitPrice;

      if (
        ingredientReqBase.unit === productPkgBase.unit &&
        productPkgBase.qty > 0
      ) {
        packsNeeded = Math.max(
          1,
          Math.ceil(ingredientReqBase.qty / productPkgBase.qty),
        );
        recipeCost = (ingredientReqBase.qty / productPkgBase.qty) * unitPrice;
        basketCost = packsNeeded * unitPrice;
      } else {
        // Unit mismatch fallback (e.g. piece count vs kg)
        packsNeeded = 1;
        recipeCost = unitPrice;
        basketCost = unitPrice;
      }

      const storeIdentifier =
        source?.name?.toLowerCase().replace(/\s+/g, "-") || "unknown";

      const offer: Offer = {
        "@type": "Offer",
        seller: {
          "@type": "Organization",
          name: source?.name || "Unknown Supermarket",
          identifier: storeIdentifier,
        },
        itemOffered: {
          "@type": "Product",
          name: product.name,
          sku: product.sku || product.externalId || null,
          url: product.url || null,
          brand: product.brand || null,
        },
        price: unitPrice,
        priceCurrency: currency,
        availability:
          product.stockInHand !== null &&
          product.stockInHand !== undefined &&
          product.stockInHand <= 0
            ? "https://schema.org/OutOfStock"
            : "https://schema.org/InStock",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: unitPrice,
          priceCurrency: currency,
          referenceQuantity: {
            "@type": "QuantitativeValue",
            value: normalizedPkg.quantity,
            unitText: normalizedPkg.unit,
          },
        },
        packsNeeded,
        recipeCost: Math.round(recipeCost * 100) / 100,
        basketCost: Math.round(basketCost * 100) / 100,
      };

      candidateOffers.push(offer);
    }

    evaluations.push({
      supply: baseSupply,
      offers: candidateOffers,
      requiredQty: scaledQty,
      requiredUnit: unitText,
      isExcluded: false,
    });
  }

  // 2️⃣ Single Store Evaluation (if "cheapest_single_store")
  let winningSingleStore: string | null = null;
  if (strategy === "cheapest_single_store") {
    const storeCoverage: Record<
      string,
      { count: number; basketTotal: number; storeName: string }
    > = {};

    for (const item of evaluations) {
      for (const offer of item.offers) {
        const storeId = offer.seller?.identifier || "unknown";
        const storeName = offer.seller?.name || "Unknown Supermarket";
        if (!storeCoverage[storeId]) {
          storeCoverage[storeId] = { count: 0, basketTotal: 0, storeName };
        }
        storeCoverage[storeId].count += 1;
        storeCoverage[storeId].basketTotal += offer.basketCost || offer.price;
      }
    }

    const rankedStores = Object.entries(storeCoverage).sort(([, a], [, b]) => {
      // Highest ingredient coverage first
      if (b.count !== a.count) return b.count - a.count;
      // Lowest total basket price second
      return a.basketTotal - b.basketTotal;
    });

    if (rankedStores.length > 0) {
      winningSingleStore = rankedStores[0][0];
    }
  }

  // 3️⃣ Final selection based on strategy
  let totalRecipeCost = 0;
  let totalBasketCost = 0;
  let totalPricedItems = 0;
  let defaultCurrency = "LKR";

  for (const item of evaluations) {
    if (item.offers.length === 0) {
      item.supply.status = "unpriced";
      item.supply.note = "No price available";
      enrichedIngredients.push(item.supply);
      continue;
    }

    // Sort candidate offers
    if (strategy === "expensive") {
      item.offers.sort(
        (a, b) => (b.recipeCost ?? b.price) - (a.recipeCost ?? a.price),
      );
    } else if (strategy === "cheapest_single_store" && winningSingleStore) {
      // Prioritize offers from the winning single store
      item.offers.sort((a, b) => {
        const aIsWinning = a.seller?.identifier === winningSingleStore;
        const bIsWinning = b.seller?.identifier === winningSingleStore;
        if (aIsWinning && !bIsWinning) return -1;
        if (!aIsWinning && bIsWinning) return 1;
        return (a.recipeCost ?? a.price) - (b.recipeCost ?? b.price);
      });
    } else {
      // Default: cheapest per item
      item.offers.sort(
        (a, b) => (a.recipeCost ?? a.price) - (b.recipeCost ?? b.price),
      );
    }

    const primaryOffer = item.offers[0];
    defaultCurrency = primaryOffer.priceCurrency;

    item.supply.status = "priced";
    item.supply.offers = item.offers;

    totalRecipeCost += primaryOffer.recipeCost ?? primaryOffer.price;
    totalBasketCost += primaryOffer.basketCost ?? primaryOffer.price;
    totalPricedItems += 1;

    // Track in store breakdown
    const storeKey = primaryOffer.seller?.identifier || "unknown";
    const storeName = primaryOffer.seller?.name || "Unknown Supermarket";

    if (!storeStats[storeKey]) {
      storeStats[storeKey] = {
        storeName,
        itemCount: 0,
        recipeSubtotal: 0,
        basketSubtotal: 0,
        missingItems: [],
      };
    }
    storeStats[storeKey].itemCount += 1;
    storeStats[storeKey].recipeSubtotal +=
      primaryOffer.recipeCost ?? primaryOffer.price;
    storeStats[storeKey].basketSubtotal +=
      primaryOffer.basketCost ?? primaryOffer.price;

    enrichedIngredients.push(item.supply);
  }

  // Round breakdown totals
  const storeBreakdown: Record<string, StoreBreakdown> = {};
  for (const [k, v] of Object.entries(storeStats)) {
    storeBreakdown[k] = {
      ...v,
      recipeSubtotal: Math.round(v.recipeSubtotal * 100) / 100,
      basketSubtotal: Math.round(v.basketSubtotal * 100) / 100,
    };
  }

  // Assemble Top-Level AggregateOffer
  const aggregateOffer: AggregateOffer = {
    "@type": "AggregateOffer",
    priceCurrency: defaultCurrency,
    lowPrice: Math.round(totalRecipeCost * 100) / 100,
    highPrice: Math.round(totalBasketCost * 100) / 100,
    offerCount: totalPricedItems,
    priceSpecification: [
      {
        "@type": "UnitPriceSpecification",
        name: "Total Recipe Cost (Pro-rata)",
        price: Math.round(totalRecipeCost * 100) / 100,
        priceCurrency: defaultCurrency,
      },
      {
        "@type": "UnitPriceSpecification",
        name: "Total Basket Cost (Cashier Checkout)",
        price: Math.round(totalBasketCost * 100) / 100,
        priceCurrency: defaultCurrency,
      },
      {
        "@type": "UnitPriceSpecification",
        name: "Cost Per Serving",
        price: Math.round((totalRecipeCost / targetServings) * 100) / 100,
        priceCurrency: defaultCurrency,
      },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.name,
    recipeYield: targetServings,
    offers: aggregateOffer,
    recipeIngredient: enrichedIngredients,
    storeBreakdown,
  };
}
