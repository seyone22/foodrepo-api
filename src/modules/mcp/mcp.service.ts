import { Injectable } from "@nestjs/common";
import { IngredientsService } from "../ingredients/ingredients.service";
import { assertScope, McpAuthContext } from "./mcp-auth.util";

@Injectable()
export class McpService {
  constructor(private readonly ingredientsService: IngredientsService) {}

  getToolsList() {
    return [
      {
        name: "search_ingredients",
        description:
          "Search canonical culinary ingredients across names, aliases, country of origin, regional sub-cuisines, and organoleptic flavor profiles.",
        annotations: {
          title: "Search Ingredients",
          readOnlyHint: true,
          destructiveHint: false,
        },
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search keyword for ingredient name or alias (e.g. 'cinnamon', 'goraka')",
            },
            cuisine: {
              type: "string",
              description: "Culinary tradition filter (e.g. 'Sri Lankan', 'Indian', 'Italian')",
            },
            country: {
              type: "string",
              description: "Country of origin filter (e.g. 'Sri Lanka', 'India')",
            },
            region: {
              type: "string",
              description: "Regional hierarchy filter (e.g. 'South Asia', 'Mediterranean')",
            },
            flavor: {
              type: "string",
              description: "Organoleptic flavor attribute (e.g. 'Sour', 'Aromatic', 'Pungent', 'Umami')",
            },
            page: {
              type: "integer",
              default: 1,
              description: "Pagination page number (1-indexed)",
            },
            limit: {
              type: "integer",
              default: 15,
              description: "Number of records to retrieve per page (max 50)",
            },
            includeProducts: {
              type: "boolean",
              default: false,
              description: "Whether to include mapped retail products and barcodes",
            },
          },
        },
      },
      {
        name: "get_ingredient_details",
        description:
          "Retrieve full canonical specification for an ingredient by UUID, including USDA nutritional facts, flavor pairings, varieties, and culinary derivatives.",
        annotations: {
          title: "Get Ingredient Details",
          readOnlyHint: true,
          destructiveHint: false,
        },
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string",
              description: "Unique UUID or identifier of the canonical ingredient",
            },
            includeProducts: {
              type: "boolean",
              default: true,
              description: "Attach mapped supermarket retail products",
            },
          },
        },
      },
      {
        name: "get_ingredient_prices",
        description:
          "Fetch live pricing, stock, pack sizes, and store availability for an ingredient across supermarket chains (Keells, Cargills, Glomark).",
        annotations: {
          title: "Get Ingredient Prices",
          readOnlyHint: true,
          destructiveHint: false,
        },
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: {
              type: "string",
              description: "Unique UUID of the canonical ingredient",
            },
          },
        },
      },
      {
        name: "match_ingredient",
        description:
          "Performs semantic embedding vector matching to find the closest canonical ingredient match for any raw recipe text or product description.",
        annotations: {
          title: "Match Ingredient Semantics",
          readOnlyHint: true,
          destructiveHint: false,
        },
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: {
            query: {
              type: "string",
              description: "Raw food name or product phrase to match (e.g. 'Ceylon Cinnamon sticks 50g')",
            },
          },
        },
      },
      {
        name: "contribute_ingredient",
        description:
          "Add a newly discovered canonical ingredient into the knowledge base, automatically generating vector embeddings.",
        annotations: {
          title: "Contribute Canonical Ingredient",
          readOnlyHint: false,
          destructiveHint: false,
        },
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: {
            name: {
              type: "string",
              description: "Canonical English or common title of the ingredient",
            },
            aliases: {
              type: "array",
              items: { type: "string" },
              description: "Vernacular, regional, or scientific synonyms",
            },
            country: {
              type: "array",
              items: { type: "string" },
              description: "Countries of primary cultivation or usage",
            },
            cuisine: {
              type: "array",
              items: { type: "string" },
              description: "Associated cuisines (e.g. ['Sri Lankan', 'South Indian'])",
            },
            region: {
              type: "array",
              items: { type: "string" },
              description: "Broader regional categories",
            },
            flavor_profile: {
              type: "array",
              items: { type: "string" },
              description: "Taste and aromatic attributes",
            },
            dietary_flags: {
              type: "array",
              items: { type: "string" },
              description: "Dietary categorizations (e.g. 'Vegan', 'Halal')",
            },
            comment: {
              type: "string",
              description: "Culinary notes or usage guidance",
            },
            photo: {
              type: "string",
              description: "Public URL of high-resolution representative photograph",
            },
          },
        },
      },
      {
        name: "update_ingredient",
        description:
          "Update an existing canonical ingredient record by ID with verified metadata or dietary flags.",
        annotations: {
          title: "Update Canonical Ingredient",
          readOnlyHint: false,
          destructiveHint: false,
        },
        inputSchema: {
          type: "object",
          required: ["id", "data"],
          properties: {
            id: {
              type: "string",
              description: "UUID of the ingredient to update",
            },
            data: {
              type: "object",
              description: "Key-value fields to update",
            },
          },
        },
      },
    ];
  }

  async executeTool(name: string, args: any, auth: McpAuthContext) {
    switch (name) {
      case "search_ingredients": {
        assertScope(auth, "read:ingredients");
        const page = Math.max(1, Number(args.page) || 1);
        const limit = Math.min(50, Math.max(1, Number(args.limit) || 15));
        return this.ingredientsService.searchIngredients(args.query || "", {
          page,
          limit,
          cuisine: args.cuisine || null,
          country: args.country || null,
          region: args.region || null,
          flavor: args.flavor || null,
          includeProducts: Boolean(args.includeProducts),
        });
      }

      case "get_ingredient_details": {
        assertScope(auth, "read:ingredients");
        if (!args.id) throw new Error("Missing required parameter 'id'");
        const result = await this.ingredientsService.getIngredientById(
          args.id,
          args.includeProducts ?? true,
        );
        if (!result) throw new Error(`Ingredient with id '${args.id}' not found`);
        return result;
      }

      case "get_ingredient_prices": {
        assertScope(auth, "read:products");
        if (!args.id) throw new Error("Missing required parameter 'id'");
        const result = await this.ingredientsService.getIngredientPrices(args.id);
        if (!result) throw new Error(`Ingredient with id '${args.id}' not found`);
        return result;
      }

      case "match_ingredient": {
        assertScope(auth, "read:ingredients");
        if (!args.query?.trim()) throw new Error("Missing required parameter 'query'");
        return this.ingredientsService.getBestIngredientMatch(args.query.trim());
      }

      case "contribute_ingredient": {
        assertScope(auth, "write:ingredients");
        return this.ingredientsService.addIngredient(args);
      }

      case "update_ingredient": {
        assertScope(auth, "write:ingredients");
        if (!args.id) throw new Error("Missing required parameter 'id'");
        return this.ingredientsService.updateIngredient(args.id, args.data || {});
      }

      default:
        throw new Error(`Requested tool '${name}' was not found`);
    }
  }

  getResourcesList() {
    return [
      {
        uri: "foodrepo://taxonomies/cuisines",
        name: "Supported Cuisines Taxonomy",
        description: "Standardized list of regional and international culinary traditions indexed in FoodRepo.",
        mimeType: "application/json",
      },
      {
        uri: "foodrepo://taxonomies/dietary-flags",
        name: "Supported Dietary Flags",
        description: "Standardized allergen, lifestyle, and religious dietary flags supported by the knowledge base.",
        mimeType: "application/json",
      },
    ];
  }

  readResource(uri: string) {
    if (uri === "foodrepo://taxonomies/cuisines") {
      return [
        "Sri Lankan",
        "South Indian",
        "North Indian",
        "Chettinad",
        "Mughlai",
        "Kerala",
        "Italian",
        "Chinese",
        "Sichuan",
        "Thai",
        "Japanese",
        "Mexican",
        "Mediterranean",
      ];
    }

    if (uri === "foodrepo://taxonomies/dietary-flags") {
      return [
        "Vegan",
        "Vegetarian",
        "Gluten-Free",
        "Halal",
        "Kosher",
        "Dairy-Free",
        "Nut-Free",
      ];
    }

    return null;
  }
}
