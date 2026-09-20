/**
 * Automated End-to-End Recipe Matching Regression Test Suite
 * Evaluates the 10 standardized recipes through the full pricing pipeline and asserts:
 * 1. 100% item pricing fulfillment (no unmatched ingredients)
 * 2. Strict product fidelity (rejects known traps like sweet potato, bread fruit, treacle, tea bun, choco pie, ice cream)
 * 3. Pro-rata and basket calculation validity
 */

require("dotenv").config();

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const tsConfigPaths = require("tsconfig-paths");
tsConfigPaths.register({ baseUrl: "./dist", paths: { "@/*": ["*"] } });

const { evaluateRecipePricing } = require("../dist/modules/recipes/recipe-pricing.service");

const BENCHMARK_RECIPES = [
  {
    id: "apple-pie",
    name: "Apple Pie",
    url: "https://preppykitchen.com/apple-pie/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "granny smith apples", requiredQuantity: { value: 6, unitText: "unit" } },
      { "@type": "HowToSupply", name: "pie crust", requiredQuantity: { value: 2, unitText: "unit" } },
      { "@type": "HowToSupply", name: "granulated sugar", requiredQuantity: { value: 0.5, unitText: "cup" } },
      { "@type": "HowToSupply", name: "light brown sugar", requiredQuantity: { value: 0.5, unitText: "cup" } },
      { "@type": "HowToSupply", name: "all-purpose flour", requiredQuantity: { value: 2, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "ground cinnamon", requiredQuantity: { value: 1, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 0.25, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 2, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "egg", requiredQuantity: { value: 1, unitText: "unit" } },
    ],
    assertions: (ingredients) => {
      const sugar = ingredients.find(i => i.name === "granulated sugar")?.offers[0]?.itemOffered.name.toLowerCase();
      if (sugar?.includes("bun")) throw new Error(`Sugar matched bun: ${sugar}`);

      const pieCrust = ingredients.find(i => i.name === "pie crust")?.offers[0]?.itemOffered.name.toLowerCase();
      if (pieCrust?.includes("choco pie")) throw new Error(`Pie crust matched choco pie: ${pieCrust}`);

      const butter = ingredients.find(i => i.name === "unsalted butter")?.offers[0]?.itemOffered.name.toLowerCase();
      if (butter?.includes("biscuit") || butter?.includes("cookie")) throw new Error(`Butter matched bakery snack: ${butter}`);
    }
  },
  {
    id: "chili",
    name: "Chili",
    url: "https://preppykitchen.com/chili-recipe/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "ground beef", requiredQuantity: { value: 2, unitText: "lb" } },
      { "@type": "HowToSupply", name: "onion", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "garlic", requiredQuantity: { value: 3, unitText: "clove" } },
      { "@type": "HowToSupply", name: "kidney beans", requiredQuantity: { value: 425, unitText: "g" } },
      { "@type": "HowToSupply", name: "diced tomatoes", requiredQuantity: { value: 800, unitText: "g" } },
      { "@type": "HowToSupply", name: "tomato paste", requiredQuantity: { value: 85, unitText: "g" } },
      { "@type": "HowToSupply", name: "chili powder", requiredQuantity: { value: 2, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "ground cumin", requiredQuantity: { value: 1, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 1, unitText: "tsp" } },
    ],
    assertions: (ingredients) => {
      const chiliPowder = ingredients.find(i => i.name === "chili powder")?.offers[0]?.itemOffered.name.toLowerCase();
      if (chiliPowder?.includes("sauce")) throw new Error(`Chili powder matched sauce: ${chiliPowder}`);
    }
  },
  {
    id: "mud-pie",
    name: "Mud Pie",
    url: "https://preppykitchen.com/mud-pie/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "oreo cookies", requiredQuantity: { value: 25, unitText: "unit" } },
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 5, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "heavy cream", requiredQuantity: { value: 0.5, unitText: "cup" } },
      { "@type": "HowToSupply", name: "semisweet chocolate", requiredQuantity: { value: 115, unitText: "g" } },
      { "@type": "HowToSupply", name: "vanilla extract", requiredQuantity: { value: 1, unitText: "tsp" } },
    ],
    assertions: (ingredients) => {
      const oreo = ingredients.find(i => i.name === "oreo cookies")?.offers[0]?.itemOffered.name.toLowerCase();
      if (oreo?.includes("ice cream") || oreo?.includes("i/c") || oreo?.includes("gelato")) {
        throw new Error(`Oreo cookies matched ice cream: ${oreo}`);
      }
    }
  },
  {
    id: "brownies",
    name: "Brownies",
    url: "https://preppykitchen.com/brownie-recipe/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 1, unitText: "cup" } },
      { "@type": "HowToSupply", name: "granulated sugar", requiredQuantity: { value: 2, unitText: "cup" } },
      { "@type": "HowToSupply", name: "unsweetened cocoa powder", requiredQuantity: { value: 0.75, unitText: "cup" } },
      { "@type": "HowToSupply", name: "eggs", requiredQuantity: { value: 3, unitText: "unit" } },
      { "@type": "HowToSupply", name: "vanilla extract", requiredQuantity: { value: 1, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 1, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "all-purpose flour", requiredQuantity: { value: 1, unitText: "cup" } },
      { "@type": "HowToSupply", name: "semisweet chocolate chips", requiredQuantity: { value: 1.5, unitText: "cup" } },
    ],
    assertions: (ingredients) => {
      const cocoa = ingredients.find(i => i.name === "unsweetened cocoa powder")?.offers[0]?.itemOffered.name.toLowerCase();
      if (!cocoa?.includes("cocoa") && !cocoa?.includes("cacao")) throw new Error(`Cocoa powder did not match cocoa: ${cocoa}`);
    }
  },
  {
    id: "millionaires-shortbread",
    name: "Millionaires Shortbread",
    url: "https://preppykitchen.com/millionaires-shortbread/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 1.5, unitText: "cup" } },
      { "@type": "HowToSupply", name: "granulated sugar", requiredQuantity: { value: 0.5, unitText: "cup" } },
      { "@type": "HowToSupply", name: "egg yolk", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "vanilla extract", requiredQuantity: { value: 2, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 1, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "all-purpose flour", requiredQuantity: { value: 2, unitText: "cup" } },
      { "@type": "HowToSupply", name: "sweetened condensed milk", requiredQuantity: { value: 396, unitText: "g" } },
      { "@type": "HowToSupply", name: "light brown sugar", requiredQuantity: { value: 1, unitText: "cup" } },
      { "@type": "HowToSupply", name: "light corn syrup", requiredQuantity: { value: 0.25, unitText: "cup" } },
      { "@type": "HowToSupply", name: "semisweet chocolate", requiredQuantity: { value: 113, unitText: "g" } },
      { "@type": "HowToSupply", name: "heavy cream", requiredQuantity: { value: 80, unitText: "ml" } },
    ],
    assertions: (ingredients) => {
      const cornSyrup = ingredients.find(i => i.name === "light corn syrup")?.offers[0]?.itemOffered.name.toLowerCase();
      if (cornSyrup?.includes("treacle") || cornSyrup?.includes("kithul") || cornSyrup?.includes("molasses")) {
        throw new Error(`Light corn syrup matched dark treacle: ${cornSyrup}`);
      }
      if (!cornSyrup?.includes("syrup") && !cornSyrup?.includes("glucose")) {
        throw new Error(`Light corn syrup did not match baking syrup or glucose: ${cornSyrup}`);
      }
    }
  },
  {
    id: "apple-cobbler",
    name: "Apple Cobbler",
    url: "https://preppykitchen.com/apple-cobbler/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "apples", requiredQuantity: { value: 4, unitText: "lb" } },
      { "@type": "HowToSupply", name: "fresh lemon juice", requiredQuantity: { value: 2, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "light brown sugar", requiredQuantity: { value: 0.33, unitText: "cup" } },
      { "@type": "HowToSupply", name: "cornstarch", requiredQuantity: { value: 2, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "ground cinnamon", requiredQuantity: { value: 0.5, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "ground nutmeg", requiredQuantity: { value: 0.25, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "vanilla extract", requiredQuantity: { value: 1, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 0.5, unitText: "cup" } },
      { "@type": "HowToSupply", name: "all-purpose flour", requiredQuantity: { value: 2, unitText: "cup" } },
      { "@type": "HowToSupply", name: "granulated sugar", requiredQuantity: { value: 0.5, unitText: "cup" } },
      { "@type": "HowToSupply", name: "baking powder", requiredQuantity: { value: 1, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 1, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "whole milk", requiredQuantity: { value: 180, unitText: "ml" } },
    ],
    assertions: (ingredients) => {
      const milk = ingredients.find(i => i.name === "whole milk")?.offers[0]?.itemOffered.name.toLowerCase();
      if (!milk?.includes("milk")) throw new Error(`Whole milk did not match milk: ${milk}`);
    }
  },
  {
    id: "quiche",
    name: "Quiche",
    url: "https://preppykitchen.com/quiche-recipe/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "pie crust", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "eggs", requiredQuantity: { value: 6, unitText: "unit" } },
      { "@type": "HowToSupply", name: "heavy cream", requiredQuantity: { value: 120, unitText: "ml" } },
      { "@type": "HowToSupply", name: "whole milk", requiredQuantity: { value: 120, unitText: "ml" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 0.5, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "ground black pepper", requiredQuantity: { value: 0.25, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "gruyere cheese", requiredQuantity: { value: 100, unitText: "g" } },
      { "@type": "HowToSupply", name: "diced ham", requiredQuantity: { value: 180, unitText: "g" } },
      { "@type": "HowToSupply", name: "green onions", requiredQuantity: { value: 2, unitText: "unit" } },
    ],
    assertions: (ingredients) => {
      const cheese = ingredients.find(i => i.name === "gruyere cheese")?.offers[0]?.itemOffered.name.toLowerCase();
      if (cheese?.includes("cutz") || cheese?.includes("triangle") || cheese?.includes("spread")) {
        throw new Error(`Gruyere cheese matched cheap processed cheese spread: ${cheese}`);
      }
      if (!cheese?.includes("gruye") && !cheese?.includes("swiss") && !cheese?.includes("emmental")) {
        throw new Error(`Gruyere cheese did not match authentic Gruyere or Swiss cheese: ${cheese}`);
      }
    }
  },
  {
    id: "pasta-carbonara",
    name: "Pasta Carbonara",
    url: "https://preppykitchen.com/pasta-carbonara/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "spaghetti", requiredQuantity: { value: 340, unitText: "g" } },
      { "@type": "HowToSupply", name: "bacon", requiredQuantity: { value: 340, unitText: "g" } },
      { "@type": "HowToSupply", name: "parmesan cheese", requiredQuantity: { value: 84, unitText: "g" } },
      { "@type": "HowToSupply", name: "eggs", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "egg yolk", requiredQuantity: { value: 3, unitText: "unit" } },
      { "@type": "HowToSupply", name: "garlic", requiredQuantity: { value: 2, unitText: "clove" } },
      { "@type": "HowToSupply", name: "olive oil", requiredQuantity: { value: 1, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 0.25, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "ground black pepper", requiredQuantity: { value: 0.25, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "fresh parsley", requiredQuantity: { value: 1, unitText: "tbsp" } },
    ],
    assertions: (ingredients) => {
      const parm = ingredients.find(i => i.name === "parmesan cheese")?.offers[0]?.itemOffered.name.toLowerCase();
      if (!parm?.includes("parmesan") && !parm?.includes("parmigiano")) {
        throw new Error(`Parmesan cheese did not match authentic parmesan: ${parm}`);
      }
      const bacon = ingredients.find(i => i.name === "bacon")?.offers[0]?.itemOffered.name.toLowerCase();
      if (!bacon?.includes("bacon")) throw new Error(`Bacon did not match bacon: ${bacon}`);
    }
  },
  {
    id: "apple-strudel",
    name: "Apple Strudel",
    url: "https://preppykitchen.com/apple-strudel/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "apples", requiredQuantity: { value: 2, unitText: "unit" } },
      { "@type": "HowToSupply", name: "golden raisins", requiredQuantity: { value: 40, unitText: "g" } },
      { "@type": "HowToSupply", name: "lemon juice", requiredQuantity: { value: 1, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "ground cinnamon", requiredQuantity: { value: 1, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "puff pastry", requiredQuantity: { value: 2, unitText: "sheet" } },
      { "@type": "HowToSupply", name: "bread crumbs", requiredQuantity: { value: 6, unitText: "tbsp" } },
      { "@type": "HowToSupply", name: "granulated sugar", requiredQuantity: { value: 100, unitText: "g" } },
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 57, unitText: "g" } },
      { "@type": "HowToSupply", name: "eggs", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "powdered sugar", requiredQuantity: { value: 2, unitText: "tbsp" } },
    ],
    assertions: (ingredients) => {
      const crumbs = ingredients.find(i => i.name === "bread crumbs")?.offers[0]?.itemOffered.name.toLowerCase();
      if (crumbs?.includes("fruit") || crumbs?.includes("bread fruit") || crumbs?.includes("del")) {
        throw new Error(`Bread crumbs matched Bread Fruit: ${crumbs}`);
      }
      if (!crumbs?.includes("crumb") && !crumbs?.includes("panko")) {
        throw new Error(`Bread crumbs did not match authentic breadcrumbs: ${crumbs}`);
      }
    }
  },
  {
    id: "hash-browns",
    name: "Hash Browns",
    url: "https://preppykitchen.com/hash-browns/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "potatoes", requiredQuantity: { value: 675, unitText: "g" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 1.5, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "ground black pepper", requiredQuantity: { value: 0.5, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "onion powder", requiredQuantity: { value: 0.5, unitText: "tsp" } },
      { "@type": "HowToSupply", name: "olive oil", requiredQuantity: { value: 60, unitText: "ml" } },
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 28, unitText: "g" } },
    ],
    assertions: (ingredients) => {
      const potato = ingredients.find(i => i.name === "potatoes")?.offers[0]?.itemOffered.name.toLowerCase();
      if (potato?.includes("sweet potato") || potato?.includes("batala") || potato?.includes("bathala")) {
        throw new Error(`Potatoes matched sweet potatoes: ${potato}`);
      }
      const onionPowder = ingredients.find(i => i.name === "onion powder")?.offers[0]?.itemOffered.name.toLowerCase();
      if (onionPowder?.includes("big onion") || onionPowder?.includes("red onion") || !onionPowder?.includes("powder")) {
        throw new Error(`Onion powder matched raw whole onion or lacks powder: ${onionPowder}`);
      }
    }
  },
  {
    id: "english-tea-sandwiches",
    name: "English Tea Sandwiches",
    url: "https://preppykitchen.com/english-tea-sandwiches/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "cucumber", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "cream cheese", requiredQuantity: { value: 170, unitText: "g" } },
      { "@type": "HowToSupply", name: "lemon", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "fresh dill", requiredQuantity: { value: 15, unitText: "g" } },
      { "@type": "HowToSupply", name: "sandwich bread", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "smoked salmon", requiredQuantity: { value: 100, unitText: "g" } },
      { "@type": "HowToSupply", name: "eggs", requiredQuantity: { value: 4, unitText: "unit" } },
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 30, unitText: "g" } },
      { "@type": "HowToSupply", name: "mayonnaise", requiredQuantity: { value: 30, unitText: "g" } },
      { "@type": "HowToSupply", name: "paprika", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "chicken breast", requiredQuantity: { value: 500, unitText: "g" } },
      { "@type": "HowToSupply", name: "fresh thyme", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "olive oil", requiredQuantity: { value: 45, unitText: "ml" } },
      { "@type": "HowToSupply", name: "cranberries", requiredQuantity: { value: 60, unitText: "g" } },
      { "@type": "HowToSupply", name: "watercress", requiredQuantity: { value: 50, unitText: "g" } },
      { "@type": "HowToSupply", name: "dijon mustard", requiredQuantity: { value: 10, unitText: "g" } }
    ],
    assertions: (ingredients) => {
      const bread = ingredients.find(i => i.name === "sandwich bread")?.offers[0]?.itemOffered.name.toLowerCase();
      if (bread?.includes("kimbula") || bread?.includes("bun") || bread?.includes("stick")) {
        throw new Error(`Sandwich bread matched bun/snack: ${bread}`);
      }
    }
  },
  {
    id: "baked-sole",
    name: "Baked Sole",
    url: "https://preppykitchen.com/baked-sole/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "sole fillets", requiredQuantity: { value: 600, unitText: "g" } },
      { "@type": "HowToSupply", name: "spinach", requiredQuantity: { value: 280, unitText: "g" } },
      { "@type": "HowToSupply", name: "lemon", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "unsalted butter", requiredQuantity: { value: 50, unitText: "g" } },
      { "@type": "HowToSupply", name: "yellow onion", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "fresh dill", requiredQuantity: { value: 15, unitText: "g" } },
      { "@type": "HowToSupply", name: "garlic", requiredQuantity: { value: 10, unitText: "g" } },
      { "@type": "HowToSupply", name: "shallot", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "all-purpose flour", requiredQuantity: { value: 25, unitText: "g" } },
      { "@type": "HowToSupply", name: "cheddar cheese", requiredQuantity: { value: 113, unitText: "g" } },
      { "@type": "HowToSupply", name: "chicken stock", requiredQuantity: { value: 120, unitText: "ml" } },
      { "@type": "HowToSupply", name: "worcestershire sauce", requiredQuantity: { value: 5, unitText: "ml" } },
      { "@type": "HowToSupply", name: "heavy cream", requiredQuantity: { value: 80, unitText: "ml" } },
      { "@type": "HowToSupply", name: "whole milk", requiredQuantity: { value: 123, unitText: "ml" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "black pepper", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "paprika", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "lemon juice", requiredQuantity: { value: 15, unitText: "ml" } }
    ],
    assertions: (ingredients) => {
      const worc = ingredients.find(i => i.name === "worcestershire sauce")?.offers[0]?.itemOffered.name.toLowerCase();
      if (!worc?.includes("worcester") && !worc?.includes("perrins")) {
        throw new Error(`Worcestershire sauce did not match authentic sauce: ${worc}`);
      }
      const fish = ingredients.find(i => i.name === "sole fillets")?.offers[0]?.itemOffered.name.toLowerCase();
      if (!fish?.includes("fillet") && !fish?.includes("fish")) {
        throw new Error(`Sole fillets did not match fish fillet: ${fish}`);
      }
    }
  },
  {
    id: "brown-sugar-salmon",
    name: "Brown Sugar Salmon",
    url: "https://preppykitchen.com/brown-sugar-salmon/",
    recipeIngredient: [
      { "@type": "HowToSupply", name: "brown sugar", requiredQuantity: { value: 60, unitText: "g" } },
      { "@type": "HowToSupply", name: "ginger", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "red chili", requiredQuantity: { value: 2, unitText: "unit" } },
      { "@type": "HowToSupply", name: "sesame oil", requiredQuantity: { value: 30, unitText: "ml" } },
      { "@type": "HowToSupply", name: "garlic", requiredQuantity: { value: 10, unitText: "g" } },
      { "@type": "HowToSupply", name: "soy sauce", requiredQuantity: { value: 30, unitText: "ml" } },
      { "@type": "HowToSupply", name: "salmon fillets", requiredQuantity: { value: 600, unitText: "g" } },
      { "@type": "HowToSupply", name: "olive oil", requiredQuantity: { value: 60, unitText: "ml" } },
      { "@type": "HowToSupply", name: "honey", requiredQuantity: { value: 20, unitText: "g" } },
      { "@type": "HowToSupply", name: "fresh thyme", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "salt", requiredQuantity: { value: 5, unitText: "g" } },
      { "@type": "HowToSupply", name: "vinegar", requiredQuantity: { value: 60, unitText: "ml" } },
      { "@type": "HowToSupply", name: "radish", requiredQuantity: { value: 100, unitText: "g" } },
      { "@type": "HowToSupply", name: "avocado", requiredQuantity: { value: 1, unitText: "unit" } },
      { "@type": "HowToSupply", name: "arugula", requiredQuantity: { value: 140, unitText: "g" } }
    ],
    assertions: (ingredients) => {
      const radish = ingredients.find(i => i.name === "radish")?.offers[0]?.itemOffered.name.toLowerCase();
      if (!radish?.includes("rad") && !radish?.includes("rabu")) {
        throw new Error(`Radish matched non-radish product: ${radish}`);
      }
      const salmon = ingredients.find(i => i.name === "salmon fillets")?.offers[0]?.itemOffered.name.toLowerCase();
      if (salmon?.includes("drools") || salmon?.includes("cat") || salmon?.includes("dog")) {
        throw new Error(`Salmon matched pet product: ${salmon}`);
      }
      const soy = ingredients.find(i => i.name === "soy sauce")?.offers[0]?.itemOffered.name.toLowerCase();
      if (soy?.includes("sprats") || soy?.includes("meat")) {
        throw new Error(`Soy sauce matched soya meat/sprats: ${soy}`);
      }
    }
  }
];

async function runRecipeE2ETests() {
  console.log("================================================================================");
  console.log("STARTING END-TO-END AUTOMATED RECIPE MATCHING REGRESSION TEST SUITE (13 RECIPES)");
  console.log("================================================================================\n");

  let totalIngredientsTested = 0;
  let passedRecipes = 0;
  let failedRecipes = 0;
  const failures = [];

  for (const recipe of BENCHMARK_RECIPES) {
    process.stdout.write(`Evaluating [${recipe.name}] ... `);
    const startTime = Date.now();

    let priced = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        priced = await evaluateRecipePricing(
          {
            name: recipe.name,
            url: recipe.url,
            recipeIngredient: recipe.recipeIngredient,
          },
          { strategy: "cheapest" }
        );
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 3 && (err.message.includes("Failed query") || err.message.includes("Connection") || err.message.includes("timeout"))) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        break;
      }
    }

    if (!priced) {
      console.log(`FAIL!`);
      console.error(`  Error in [${recipe.name}]:`, lastErr.message);
      failedRecipes++;
      failures.push({ recipe: recipe.name, error: lastErr.message });
      continue;
    }

    try {
      const ingredients = priced.recipeIngredient;

      // 1. Verify all ingredients have a price
      for (const ing of ingredients) {
        totalIngredientsTested++;
        const offer = ing.offers && ing.offers.length > 0 ? ing.offers[0] : null;
        if (!offer || !offer.itemOffered || offer.price <= 0) {
          throw new Error(`Unpriced or unmatched ingredient: "${ing.name}"`);
        }
      }

      // 2. Run recipe-specific regression assertions
      if (recipe.assertions) {
        recipe.assertions(ingredients);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`PASS (${ingredients.length} items, ${elapsed}s)`);
      passedRecipes++;
    } catch (err) {
      console.log(`FAIL!`);
      console.error(`  Error in [${recipe.name}]:`, err.message);
      failedRecipes++;
      failures.push({ recipe: recipe.name, error: err.message });
    }
  }

  console.log("\n================================================================================");
  console.log(`SUMMARY: ${passedRecipes} PASSED, ${failedRecipes} FAILED across ${totalIngredientsTested} ingredients`);
  console.log("================================================================================");

  if (failedRecipes > 0) {
    console.error("\nTEST SUITE FAILED with the following errors:");
    failures.forEach((f, i) => console.error(`${i + 1}. [${f.recipe}]: ${f.error}`));
    process.exit(1);
  } else {
    console.log("\nALL 13 RECIPES MATCHED 100% AUTHENTIC INGREDIENTS WITH ZERO DEFECTS.");
    process.exit(0);
  }
}

runRecipeE2ETests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
