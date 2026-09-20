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
import {
  GraphTraversalService,
  type TraversalResolution,
} from "../graph/graph-traversal.service";

// ---------------------------------------------------------------------------
// Unit Conversion Helpers
// ---------------------------------------------------------------------------

interface StandardizedQty {
  qty: number;
  unit: "g" | "ml" | "unit";
}

function toBaseUnit(
  qty: number,
  rawUnit?: string,
  ingredientName?: string,
): StandardizedQty {
  const u = (rawUnit || "").toLowerCase().trim();
  const ingName = (ingredientName || "").toLowerCase().trim();

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
  if (["lb", "lbs", "pound", "pounds"].includes(u)) {
    return { qty: qty * 453.59237, unit: "g" };
  }
  if (["oz", "ounce", "ounces"].includes(u)) {
    return { qty: qty * 28.34952, unit: "g" };
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
  if (["fl oz", "fluid ounce", "fluid ounces"].includes(u)) {
    return { qty: qty * 29.5735, unit: "ml" };
  }
  if (["pint", "pints", "pt"].includes(u)) {
    return { qty: qty * 473.176, unit: "ml" };
  }
  if (["quart", "quarts", "qt"].includes(u)) {
    return { qty: qty * 946.353, unit: "ml" };
  }
  if (["gallon", "gallons", "gal"].includes(u)) {
    return { qty: qty * 3785.41, unit: "ml" };
  }

  // Culinary packaging containers -> grams or ml
  if (["can", "cans", "tin", "tins"].includes(u)) {
    if (ingName.includes("condensed milk")) {
      return { qty: qty * 390, unit: "g" };
    }
    if (ingName.includes("coconut milk")) {
      return { qty: qty * 400, unit: "ml" };
    }
    return { qty: qty * 425, unit: "g" };
  }
  if (["bunch", "bunches"].includes(u)) {
    return { qty: qty * 150, unit: "g" };
  }
  if (["pinch", "pinches", "dash", "dashes"].includes(u)) {
    return { qty: qty * 1, unit: "g" };
  }
  if (["packet", "packets", "pack", "packs", "pkg"].includes(u)) {
    return { qty: qty * 250, unit: "g" };
  }

  // Count / discrete units
  return { qty, unit: "unit" };
}

// ---------------------------------------------------------------------------
// Average Piece Weights (Grams) for Discrete Produce Items
// Bridges recipes asking for pieces/counts with products sold by weight (kg/g)
// and vice-versa (e.g. recipe wants 1kg apples, product sold in 3-packs).
// ---------------------------------------------------------------------------
const AVERAGE_PIECE_WEIGHT_GRAMS: Record<string, number> = {
  apple: 180,
  apples: 180,
  lemon: 60,
  lemons: 60,
  lime: 45,
  limes: 45,
  orange: 150,
  oranges: 150,
  banana: 120,
  bananas: 120,
  egg: 50,
  eggs: 50,
  onion: 150,
  onions: 150,
  "red onion": 100,
  "big onion": 150,
  "green onion": 15,
  "green onions": 15,
  scallion: 15,
  scallions: 15,
  "spring onion": 15,
  "spring onions": 15,
  "onion leaf": 15,
  "onion leaves": 15,
  "shredded cheese": 113,
  "grated cheese": 100,
  potato: 170,
  potatoes: 170,
  tomato: 120,
  tomatoes: 120,
  garlic: 50, // 1 whole head of garlic ~ 50g
  "garlic cloves": 5,
  "garlic clove": 5,
  "cloves of garlic": 5,
  "clove of garlic": 5,
  "clove garlic": 5,
  clove: 5,
  cloves: 5,
  carrot: 100,
  carrots: 100,
  cucumber: 200,
  cucumbers: 200,
  avocado: 200,
  avocados: 200,
  coconut: 600,
  coconuts: 600,
  bellpepper: 160,
  "bell pepper": 160,
  capsicum: 160,
};

function getProducePieceWeightGrams(ingredientName: string): number | null {
  const clean = (ingredientName || "").toLowerCase().trim();
  if (AVERAGE_PIECE_WEIGHT_GRAMS[clean]) {
    return AVERAGE_PIECE_WEIGHT_GRAMS[clean];
  }
  // Sort keys descending by length so multi-word keys ("garlic cloves") match before single words ("garlic")
  const sortedEntries = Object.entries(AVERAGE_PIECE_WEIGHT_GRAMS).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [key, weight] of sortedEntries) {
    if (clean.includes(key)) {
      return weight;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Culinary Densities (Grams per Milliliter)
// Bridges volume measurements (tsp, tbsp, cup, ml) with packaged mass (g, kg)
// ---------------------------------------------------------------------------
const CULINARY_DENSITY_G_PER_ML: Record<string, number> = {
  salt: 1.2,
  "table salt": 1.2,
  "fine salt": 1.2,
  "cooking salt": 1.2,
  sugar: 0.85,
  "white sugar": 0.85,
  "brown sugar": 0.85,
  "light brown sugar": 0.85,
  "dark brown sugar": 0.85,
  "granulated sugar": 0.85,
  "powdered sugar": 0.56,
  "icing sugar": 0.56,
  flour: 0.55,
  "all purpose flour": 0.55,
  "plain flour": 0.55,
  "wheat flour": 0.55,
  cinnamon: 0.55,
  "ground cinnamon": 0.55,
  nutmeg: 0.50,
  "ground nutmeg": 0.50,
  ginger: 0.55,
  "ground ginger": 0.55,
  cloves: 0.50,
  "olive oil": 0.92,
  oil: 0.92,
  "vegetable oil": 0.92,
  honey: 1.42,
  milk: 1.03,
  "evaporated milk": 1.07,
  water: 1.0,
  butter: 0.96,
  "shredded cheese": 0.47,
  "grated cheese": 0.45,
};

function getCulinaryDensity(ingredientName: string): number {
  const clean = (ingredientName || "").toLowerCase().trim();
  if (CULINARY_DENSITY_G_PER_ML[clean]) {
    return CULINARY_DENSITY_G_PER_ML[clean];
  }
  for (const [key, density] of Object.entries(CULINARY_DENSITY_G_PER_ML)) {
    if (clean.includes(key)) {
      return density;
    }
  }
  return 1.0; // Default: 1 ml ≈ 1 g
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

  const graphTraversal = new GraphTraversalService();

  // 1️⃣ First pass: Resolve canonical ingredients & fetch all candidate store offers in parallel
  const evaluations: IngredientEvaluation[] = await Promise.all(
    recipe.recipeIngredient.map(async (rawSupply): Promise<IngredientEvaluation> => {
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
        return {
          supply: baseSupply,
          offers: [],
          requiredQty: scaledQty,
          requiredUnit: unitText,
          isExcluded: true,
        };
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
        "after shave",
        "aftershave",
        "shaving",
        "shave",
        "cologne",
        "perfume",
        "deodorant",
        "toothpaste",
        "pet food",
        "dog food",
        "cat food",
        "pedigree",
        "whiskas",
        "dettol",
        "harpic",
        "domex",
        "vim",
        "lysol",
        "savlon",
        "antiseptic",
        "disinfectant",
        "sanitizer",
        "floor cleaner",
        "toilet cleaner",
        "bleach",
        "repellent",
        "liquid detergent",
        "detergent liquid",
        "liquid soap",
      ];
      for (const bad of nonFoodKeywords) {
        if (lower.includes(bad) && !clean.includes(bad)) return false;
      }
      if (
        catPath?.some((c) =>
          /household|beauty|personal|cleaning|laundry|cosmetic|toiletries|pet|health|pharmacy/i.test(
            c,
          ),
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

      // 11. Tomatoes (exclude puree, paste, ketchup, sauces, snacks unless requested)
      if (clean.includes("tomato")) {
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
        if (
          nonFreshTomatoWords.some(
            (w) => lower.includes(w) && !clean.includes(w),
          )
        ) {
          return false;
        }
      }

      // 12. Pie Crust / Pie Dough / Pastry (exclude bread, buns, toast, rusks)
      if (
        clean.includes("crust") ||
        clean.includes("dough") ||
        clean.includes("pastry")
      ) {
        const nonPastryWords = [
          "bread",
          "paan",
          "loaf",
          "sliced",
          "sandwich",
          "bun",
          "rusk",
          "toast",
        ];
        if (nonPastryWords.some((w) => lower.includes(w))) return false;
      }

      // 13. Salt / Table Salt (exclude flavored snacks, soy meat, chips)
      if (
        clean === "salt" ||
        clean.includes("table salt") ||
        clean.includes("fine salt")
      ) {
        const nonSaltWords = [
          "soya",
          "meat",
          "curry",
          "chip",
          "cracker",
          "biscuit",
          "snack",
          "butter",
          "cashew",
          "peanut",
          "dhal",
          "fruit salt",
          "eno",
          "toothpaste",
        ];
        if (nonSaltWords.some((w) => lower.includes(w))) return false;
      }

      // 14. Spices (cinnamon, nutmeg, cloves, ginger)
      if (
        clean.includes("cinnamon") ||
        clean.includes("nutmeg") ||
        clean.includes("clove")
      ) {
        const nonSpiceWords = [
          "shave",
          "perfume",
          "fragrance",
          "soap",
          "tea",
          "shampoo",
          "lotion",
          "cream",
          "toothpaste",
          "candle",
          "incense",
          "oil 10ml",
          "essential oil",
        ];
        if (nonSpiceWords.some((w) => lower.includes(w))) return false;
      }

      // 15. Garlic: If recipe specifies garlic (e.g. garlic cloves), product must actually be garlic, not spice cloves
      if (clean.includes("garlic") && !lower.includes("garlic")) {
        return false;
      }

      // 16. Beans / Legumes (exclude tofu, curd, soy meat TVP, bean bags unless requested)
      if (clean.includes("bean")) {
        const nonBeanWords = [
          "curd",
          "tofu",
          "soya meat",
          "soy meat",
          "tvp",
          "chunks",
          "bean bag",
          "jelly bean",
        ];
        if (
          nonBeanWords.some(
            (w) => lower.includes(w) && !clean.includes(w),
          )
        ) {
          return false;
        }
      }

      // 17. Broth / Stock / Bouillon Fidelity
      if (
        clean.includes("broth") ||
        clean.includes("stock") ||
        clean.includes("bouillon") ||
        clean.includes("consomme")
      ) {
        const nonBrothWords = [
          "sausage",
          "sausages",
          "patty",
          "patties",
          "meatball",
          "meatballs",
          "steak",
          "steaks",
          "roast",
          "bacon",
          "ham",
          "mince",
          "ground",
          "smoke",
          "smoked",
          "nugget",
          "nuggets",
          "curry",
          "roll",
          "bun",
          "dettol",
          "soap",
          "cleaner",
          "shampoo",
          "bites",
          "cracker",
        ];
        if (
          nonBrothWords.some(
            (w) => lower.includes(w) && !clean.includes(w),
          )
        ) {
          return false;
        }

        // If product mentions fresh meat or poultry, it MUST be an actual broth/stock preparation (stock powder, cube, soup bone, essence)
        const meatWords = [
          "chicken",
          "beef",
          "pork",
          "mutton",
          "lamb",
          "duck",
          "turkey",
          "meat",
          "poultry",
        ];
        if (meatWords.some((w) => lower.includes(w))) {
          const brothIndicators = [
            "stock",
            "broth",
            "bouillon",
            "cube",
            "cubes",
            "powder",
            "seasoning",
            "soup bone",
            "soup bones",
            "bones",
            "bone",
            "extract",
            "essence",
            "soup",
          ];
          if (!brothIndicators.some((w) => lower.includes(w))) {
            return false;
          }
        }
      }

      // 18. Red Meat (beef, pork, mutton, lamb) & Ground/Minced Meat Fidelity
      const isBrothOrStock =
        clean.includes("broth") ||
        clean.includes("stock") ||
        clean.includes("bouillon") ||
        clean.includes("consomme");

      if (
        !isBrothOrStock &&
        (clean.includes("beef") ||
          clean.includes("pork") ||
          clean.includes("mutton") ||
          clean.includes("lamb") ||
          clean.includes("ground meat") ||
          clean.includes("mince"))
      ) {
        // If specifically asking for ground / minced meat, product MUST be minced/ground meat
        if (clean.includes("ground") || clean.includes("mince")) {
          if (
            !lower.includes("mince") &&
            !lower.includes("ground") &&
            !lower.includes("keema")
          ) {
            return false;
          }
        }

        // If recipe specifies meat, exclude processed sausages, burger patties, meatballs, curries
        const nonFreshMeatWords = [
          "sausage",
          "sausages",
          "patty",
          "patties",
          "burger",
          "meatball",
          "meatballs",
          "nugget",
          "nuggets",
          "heat & eat",
          "ready to eat",
          "rte",
          "curry paste",
          "curry mix",
          "roll",
          "ham",
          "bacon",
          "pet food",
          "cube",
          "soup cube",
          "seasoning",
        ];
        if (
          nonFreshMeatWords.some(
            (w) => lower.includes(w) && !clean.includes(w),
          )
        ) {
          return false;
        }
      }

      // 19. Chilli Powder vs Chilli Pieces / Flakes Granularity & Culinary Product Fidelity
      if (
        clean.includes("chili") ||
        clean.includes("chilli") ||
        clean.includes("cayenne")
      ) {
        const nonCulinaryChilliWords = [
          "bite",
          "bites",
          "snack",
          "snacks",
          "chip",
          "chips",
          "cracker",
          "crackers",
          "biscuit",
          "biscuits",
          "peanut",
          "peanuts",
          "cashew",
          "cashews",
          "noodle",
          "noodles",
          "mayonnaise",
          "mayo",
          "cheese",
          "spread",
          "wedges",
          "tuna",
          "vodka",
          "manioc",
          "pakada",
        ];
        if (
          nonCulinaryChilliWords.some(
            (w) => lower.includes(w) && !clean.includes(w),
          )
        ) {
          return false;
        }

        const isChilliPowderReq =
          clean.includes("cayenne") ||
          clean.includes("chilli powder") ||
          clean.includes("chili powder") ||
          clean.includes("paprika") ||
          (clean.includes("powder") &&
            (clean.includes("chilli") || clean.includes("chili")));
        const isChilliPiecesReq =
          clean.includes("piece") ||
          clean.includes("flake") ||
          clean.includes("crushed");

        if (isChilliPowderReq && !isChilliPiecesReq) {
          // Exclude pieces, flakes, crushed
          const nonPowderChilliWords = [
            "piece",
            "pieces",
            "flake",
            "flakes",
            "crushed",
          ];
          if (nonPowderChilliWords.some((w) => lower.includes(w))) return false;
        } else if (isChilliPiecesReq && !isChilliPowderReq) {
          // Exclude fine powders
          if (lower.includes("powder")) return false;
        }
      }

      // 20. Green Onions / Scallions / Spring Onions Fidelity
      const isGreenOnionReq =
        clean.includes("green onion") ||
        clean.includes("scallion") ||
        clean.includes("spring onion") ||
        clean.includes("onion leaf") ||
        clean.includes("onion leaves");

      if (isGreenOnionReq) {
        // Exclude bulb onions: big onion, red onion, bombay onion, shallots, or plain bulb onions
        const bulbOnionWords = [
          "big onion",
          "bombay onion",
          "red onion",
          "b/onion",
          "r/onion",
          "shallot",
          "pink onion",
          "white onion",
          "yellow onion",
          "brown onion",
        ];
        if (bulbOnionWords.some((w) => lower.includes(w))) return false;

        // Must have green/spring/scallion/leaf/leek identifier if it mentions onion
        const hasGreenIdentifier =
          lower.includes("green") ||
          lower.includes("spring") ||
          lower.includes("leaf") ||
          lower.includes("leaves") ||
          lower.includes("scallion") ||
          lower.includes("leek");
        if (!hasGreenIdentifier) {
          return false;
        }

        // Exclude snacks/processed/bakery
        const nonProduceWords = [
          "tipi tip",
          "chips",
          "cracker",
          "bites",
          "murukku",
          "popcorn",
          "shampoo",
          "paratha",
          "pastry",
          "sauce",
          "paste",
          "biscuit",
          "snack",
        ];
        if (nonProduceWords.some((w) => lower.includes(w))) return false;
      }

      // 21. Shredded / Grated Cheese Fidelity
      if (
        clean.includes("shredded cheese") ||
        clean.includes("grated cheese") ||
        clean.includes("shredded cheddar") ||
        clean.includes("shredded mozzarella") ||
        (clean.includes("shredded") && clean.includes("cheese")) ||
        (clean.includes("grated") && clean.includes("cheese"))
      ) {
        // Exclude smoked cheese
        if (lower.includes("smoke") || lower.includes("smoked")) {
          return false;
        }

        // Exclude processed wedges, triangles, spreads, sauces, cream cheese, dips
        const nonShreddedCheeseWords = [
          "wedge",
          "wedges",
          "triangle",
          "triangles",
          "portion",
          "portions",
          "spread",
          "sauce",
          "cream cheese",
          "dip",
          "biscuit",
          "cracker",
          "snack",
          "chips",
          "popcorn",
          "noodle",
          "pasta",
          "bites",
          "murukku",
          "tacos",
          "burger",
          "roll",
          "bun",
          "rotti",
          "paratha",
        ];
        if (nonShreddedCheeseWords.some((w) => lower.includes(w))) {
          return false;
        }
      }

      return true;
    };

    let traversal: TraversalResolution | null = null;
    let effectiveQty = scaledQty;
    let effectiveUnit = unitText;

    // Stage 1: Explicit identifier provided
    if (rawSupply.identifier) {
      try {
        traversal = await graphTraversal.resolveByIngredientId(rawSupply.identifier, {
          allowedSources: allowedSources || undefined,
          disableChildAggregation: true,
        });
        if (
          traversal &&
          traversal.products.length > 0 &&
          traversal.relation !== "ancestor"
        ) {
          const validFoodProducts = traversal.products.filter((p) =>
            isFoodProduct(p.name, p.categoryPath),
          );
          if (validFoodProducts.length > 0) {
            resolvedId = traversal.ingredientId;
            baseSupply.identifier = resolvedId;
            mappedData = validFoodProducts.map((p) => ({
              product: p,
              source: p.source as typeof priceSources.$inferSelect | null,
            }));
          }
        }
      } catch {
        // Fallback to name resolution
      }
    }

    // Stage 2: Centralized Graph Traversal (Direct -> Aliases -> Derivatives -> Ancestor)
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
        apples: ["apple", "fresh apple", "apples"],
        apple: ["apple", "fresh apple", "apples"],
        "apple juice": ["apple juice", "apple nectar"],
        "lemon juice": ["lemon juice", "lemon", "fresh lemon"],
        "black pepper": ["black pepper", "pepper powder", "peppercorns"],
        milk: ["fresh milk", "uht milk", "full cream milk", "milk"],
        garlic: ["garlic 1kg", "garlic", "fresh garlic"],
        onion: ["big onion", "red onion", "onion"],
        "green onion": [
          "spring onion",
          "onion leaves",
          "scallion",
          "green onion",
          "leeks",
        ],
        "green onions": [
          "spring onion",
          "onion leaves",
          "scallion",
          "green onion",
          "leeks",
        ],
        scallion: [
          "spring onion",
          "onion leaves",
          "scallion",
          "green onion",
          "leeks",
        ],
        scallions: [
          "spring onion",
          "onion leaves",
          "scallion",
          "green onion",
          "leeks",
        ],
        "spring onion": [
          "spring onion",
          "onion leaves",
          "scallion",
          "green onion",
          "leeks",
        ],
        "spring onions": [
          "spring onion",
          "onion leaves",
          "scallion",
          "green onion",
          "leeks",
        ],
        "onion leaves": [
          "onion leaves",
          "spring onion",
          "green onion",
          "scallion",
        ],
        "shredded cheese": [
          "shredded mozzarella",
          "shredded cheese",
          "pizza cheese",
          "grated cheese",
          "mozzarella cheese",
          "cheddar cheese",
        ],
        "grated cheese": [
          "grated cheese",
          "shredded cheese",
          "parmesan cheese",
          "mozzarella cheese",
          "cheddar cheese",
        ],
        "shredded cheddar": [
          "cheddar cheese",
          "shredded cheese",
          "shredded mozzarella",
        ],
        "shredded mozzarella": [
          "shredded mozzarella",
          "mozzarella cheese",
          "pizza cheese",
          "shredded cheese",
        ],
        "beef broth": [
          "beef stock",
          "beef broth",
          "beef bouillon",
          "stock cube",
          "seasoning cube",
          "chicken cubes",
          "chicken stock powder",
          "stock powder",
        ],
        "beef stock": [
          "beef stock",
          "beef broth",
          "beef bouillon",
          "stock cube",
          "seasoning cube",
          "chicken cubes",
          "chicken stock powder",
          "stock powder",
        ],
        "chicken broth": [
          "chicken stock",
          "chicken broth",
          "stock cube",
          "seasoning cube",
          "chicken cubes",
          "chicken stock powder",
          "stock powder",
        ],
        "chicken stock": [
          "chicken stock",
          "chicken broth",
          "stock cube",
          "seasoning cube",
          "chicken cubes",
          "chicken stock powder",
          "stock powder",
        ],
        broth: [
          "stock cube",
          "seasoning cube",
          "stock powder",
          "chicken cubes",
          "broth",
          "stock",
        ],
        stock: [
          "stock cube",
          "seasoning cube",
          "stock powder",
          "chicken cubes",
          "stock",
          "broth",
        ],
        tomatoes: ["tomatoes", "tomato", "tomato (kg)"],
        "chicken breast": [
          "chicken breast",
          "chicken breast bone-in",
          "chicken breast skinless",
        ],
        "olive oil": ["olive oil", "extra virgin olive oil"],
        "double-crust pie dough": [
          "pie dough",
          "puff pastry dough",
          "puff pastry sheet",
          "pastry dough",
          "pie crust",
        ],
        "double crust pie dough": [
          "pie dough",
          "puff pastry dough",
          "puff pastry sheet",
          "pastry dough",
          "pie crust",
        ],
        "pie dough": [
          "pie dough",
          "puff pastry sheet",
          "puff pastry dough",
          "pastry dough",
        ],
        "pie crust": [
          "pie crust",
          "pie dough",
          "puff pastry sheet",
          "puff pastry dough",
        ],
        "pastry dough": [
          "pie dough",
          "puff pastry sheet",
          "puff pastry dough",
          "pastry dough",
        ],
        "red kidney beans": [
          "red kidney beans",
          "kidney beans",
          "peacock red kidney beans",
        ],
        "kidney beans": [
          "kidney beans",
          "red kidney beans",
        ],
        "pinto beans": [
          "pinto beans",
          "red kidney beans",
          "kidney beans",
        ],
        "black beans": [
          "black beans",
          "red kidney beans",
        ],
        "baked beans": [
          "baked beans",
          "heinz baked beans",
        ],
        "tomato sauce": [
          "tomato sauce",
          "tomato puree",
          "tomato paste",
          "canned tomatoes",
        ],
        "cayenne pepper": [
          "cayenne pepper",
          "chilli powder",
          "chili powder",
          "red chili powder",
          "red chilli powder",
        ],
        "chilli powder": [
          "chilli powder",
          "chili powder",
          "cayenne pepper",
          "red chilli powder",
          "red chili powder",
        ],
        "chili powder": [
          "chilli powder",
          "chili powder",
          "cayenne pepper",
          "red chilli powder",
          "red chili powder",
        ],
        "chilli pieces": [
          "chili flake",
          "chili flakes",
          "chilli pieces",
          "chili pieces",
          "chilli flakes",
          "crushed chilli",
          "crushed red pepper",
        ],
        "chili pieces": [
          "chili flake",
          "chili flakes",
          "chilli pieces",
          "chili pieces",
          "chilli flakes",
          "crushed chilli",
          "crushed red pepper",
        ],
        "chili flakes": [
          "chili flake",
          "chili flakes",
          "chilli flakes",
          "chilli pieces",
          "chili pieces",
          "crushed red pepper",
          "crushed chilli",
        ],
        "chilli flakes": [
          "chili flake",
          "chili flakes",
          "chilli flakes",
          "chilli pieces",
          "chili pieces",
          "crushed red pepper",
          "crushed chilli",
        ],
        "garlic cloves": [
          "garlic",
          "garlic clove",
        ],
        "cloves of garlic": [
          "garlic",
          "garlic clove",
        ],
        "ground beef": [
          "beef mince",
          "minced beef",
          "ground beef",
          "beef minced",
        ],
        "minced beef": [
          "ground beef",
          "beef mince",
          "minced beef",
          "beef minced",
        ],
        "beef mince": [
          "ground beef",
          "minced beef",
          "beef mince",
          "beef minced",
        ],
        "ground pork": [
          "pork mince",
          "minced pork",
          "ground pork",
        ],
        "pork mince": [
          "ground pork",
          "minced pork",
          "pork mince",
        ],
        "ground chicken": [
          "chicken mince",
          "minced chicken",
          "ground chicken",
        ],
        "chicken mince": [
          "ground chicken",
          "minced chicken",
          "chicken mince",
        ],
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
        ...(clean.endsWith("s") && !clean.endsWith("ss") && clean.length > 3
          ? [clean.slice(0, -1)]
          : []),
        ...(clean.endsWith("es") && clean.length > 4
          ? [clean.slice(0, -2)]
          : []),
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

      // 1. Primary traversal on clean supply name
      traversal = await graphTraversal.resolveByNameOrQuery(clean, {
        allowedSources: allowedSources || undefined,
        disableChildAggregation: true,
      });

      // 2. Synonyms traversal
      if ((!traversal || traversal.products.length === 0) && SYNONYMS[clean]) {
        for (const syn of SYNONYMS[clean]) {
          traversal = await graphTraversal.resolveByNameOrQuery(syn, {
            allowedSources: allowedSources || undefined,
            disableChildAggregation: true,
          });
          if (traversal && traversal.products.length > 0) break;
        }
      }

      // 3. Fallback candidate phrases traversal
      if (!traversal || traversal.products.length === 0) {
        for (const cand of uniqueCandidates) {
          if (cand === clean) continue;
          traversal = await graphTraversal.resolveByNameOrQuery(cand, {
            allowedSources: allowedSources || undefined,
            disableChildAggregation: true,
          });
          if (traversal && traversal.products.length > 0) break;
        }
      }

      if (
        traversal &&
        traversal.products.length > 0 &&
        traversal.relation !== "ancestor"
      ) {
        const validFoodProducts = traversal.products.filter((p) =>
          isFoodProduct(p.name, p.categoryPath),
        );

        if (validFoodProducts.length > 0) {
          resolvedId = traversal.ingredientId;
          baseSupply.identifier = resolvedId;

          mappedData = validFoodProducts.map((p) => ({
            product: p,
            source: p.source as typeof priceSources.$inferSelect | null,
          }));

          if (traversal.relation === "derivative") {
            const yieldRatio = traversal.derivative?.yieldRatio;
            const reqBase = toBaseUnit(scaledQty, unitText);
            const scaleRes = graphTraversal.scaleDerivativeQuantity(
              reqBase.qty,
              reqBase.unit,
              yieldRatio,
            );
            effectiveQty = scaleRes.scaledQuantity;
            effectiveUnit = reqBase.unit;

            baseSupply.fulfillment = {
              strategy: "derivative",
              sourceIngredient:
                traversal.sourceIngredient?.name || traversal.ingredientName,
              sourceIngredientId:
                traversal.sourceIngredient?.id || traversal.ingredientId,
              process: traversal.derivative?.process,
              yieldRatio: traversal.derivative?.yieldRatio,
              lossRatio: traversal.derivative?.lossRatio,
              adjustedQuantity: {
                value: scaleRes.scaledQuantity,
                unitText: reqBase.unit,
              },
              note: scaleRes.note,
            };
            baseSupply.note = scaleRes.note;
          } else if (traversal.relation === "parent") {
            baseSupply.fulfillment = {
              strategy: traversal.relation,
              sourceIngredient:
                traversal.sourceIngredient?.name || traversal.ingredientName,
              sourceIngredientId:
                traversal.sourceIngredient?.id || traversal.ingredientId,
              note: `Fulfilled via ${traversal.relation} ingredient ${
                traversal.sourceIngredient?.name || traversal.ingredientName
              }`,
            };
            baseSupply.note = baseSupply.fulfillment.note;
          }
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
      return {
        supply: baseSupply,
        offers: [],
        requiredQty: scaledQty,
        requiredUnit: unitText,
        isExcluded: false,
      };
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
    const ingredientReqBase = toBaseUnit(effectiveQty, effectiveUnit, supplyName);
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
        product.name,
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
          Math.ceil((ingredientReqBase.qty - 0.02 * productPkgBase.qty) / productPkgBase.qty),
        );
        recipeCost = (ingredientReqBase.qty / productPkgBase.qty) * unitPrice;
        basketCost = packsNeeded * unitPrice;
      } else if (
        (ingredientReqBase.unit === "ml" && productPkgBase.unit === "g") ||
        (ingredientReqBase.unit === "g" && productPkgBase.unit === "ml")
      ) {
        // Continuous volume <-> mass conversion via culinary density
        const density = traversal?.density ?? getCulinaryDensity(supplyName);
        let reqGrams =
          ingredientReqBase.unit === "ml"
            ? ingredientReqBase.qty * density
            : ingredientReqBase.qty;
        const pkgGrams =
          productPkgBase.unit === "ml"
            ? productPkgBase.qty * density
            : productPkgBase.qty;

        // Reconstitution for concentrated stock cubes and powders:
        // 1 cup (240ml) liquid broth = ~1 stock cube (10g) or ~5g powder
        const isBrothReq =
          supplyName.toLowerCase().includes("broth") ||
          supplyName.toLowerCase().includes("stock") ||
          supplyName.toLowerCase().includes("bouillon");
        const isDryConcentrate =
          product.name.toLowerCase().includes("cube") ||
          product.name.toLowerCase().includes("powder") ||
          product.name.toLowerCase().includes("seasoning");

        if (isBrothReq && isDryConcentrate && ingredientReqBase.unit === "ml") {
          reqGrams = (ingredientReqBase.qty / 240) * 10;
        }

        if (pkgGrams > 0) {
          packsNeeded = Math.max(1, Math.ceil(reqGrams / pkgGrams));
          recipeCost = (reqGrams / pkgGrams) * unitPrice;
          basketCost = packsNeeded * unitPrice;
        }
      } else {
        // Unit mismatch: check if one side is discrete pieces ("unit") and the other is mass ("g") or volume ("ml")
        const pieceWeight =
          getProducePieceWeightGrams(supplyName) ||
          (rawSupply.identifier
            ? getProducePieceWeightGrams(rawSupply.identifier)
            : null);

        if (pieceWeight && pieceWeight > 0) {
          let reqGrams = ingredientReqBase.qty;
          let pkgGrams = productPkgBase.qty;

          // Case A: Recipe wants discrete pieces ("unit"), product is sold by mass/volume ("g" / "ml")
          if (
            ingredientReqBase.unit === "unit" &&
            (productPkgBase.unit === "g" || productPkgBase.unit === "ml")
          ) {
            reqGrams = ingredientReqBase.qty * pieceWeight;
          }
          // Case B: Recipe wants mass/volume ("g" / "ml"), product is sold by discrete pieces ("unit")
          else if (
            (ingredientReqBase.unit === "g" || ingredientReqBase.unit === "ml") &&
            productPkgBase.unit === "unit"
          ) {
            pkgGrams = productPkgBase.qty * pieceWeight;
          }

          if (pkgGrams > 0) {
            packsNeeded = Math.max(1, Math.ceil(reqGrams / pkgGrams));
            recipeCost = (reqGrams / pkgGrams) * unitPrice;
            basketCost = packsNeeded * unitPrice;
          }
        } else {
          // Fallback when no conversion is known
          packsNeeded = 1;
          recipeCost = unitPrice;
          basketCost = unitPrice;
        }
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

      return {
        supply: baseSupply,
        offers: candidateOffers,
        requiredQty: scaledQty,
        requiredUnit: unitText,
        isExcluded: false,
      };
    }),
  );

  // 2️⃣ Single Store Evaluation (if "cheapest_single_store")
  let winningSingleStore: string | null = null;
  if (strategy === "cheapest_single_store") {
    const storeCoverage: Record<
      string,
      { count: number; basketTotal: number; storeName: string }
    > = {};

    for (const item of evaluations) {
      if (item.isExcluded) continue;
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
    if (item.isExcluded) {
      enrichedIngredients.push(item.supply);
      continue;
    }

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
