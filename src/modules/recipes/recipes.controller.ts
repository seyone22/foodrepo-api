import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import {
  type ParseAndPriceRequest,
  type RecipePricingRequest,
  parseAndPriceRequestSchema,
  recipeOptionsSchema,
} from "./dto/recipes.dto";
import {
  type SchemaOrgRecipe,
  recipePricingRequestSchema,
} from "./dto/recipePricing.dto";
import { RecipeAiService } from "./recipe-ai.service";
import { evaluateRecipePricing } from "./recipe-pricing.service";

function extractRecipeJsonLd(html: string): Record<string, unknown> | null {
  const scriptMatches = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!scriptMatches) return null;

  for (const tag of scriptMatches) {
    const jsonStr = tag
      .replace(/<script[^>]*>/i, "")
      .replace(/<\/script>/i, "")
      .trim();
    try {
      const parsed = JSON.parse(jsonStr);
      const items: Array<Record<string, unknown>> = Array.isArray(parsed)
        ? parsed
        : parsed["@graph"] || [parsed];

      for (const item of items) {
        if (
          item["@type"] === "Recipe" ||
          (Array.isArray(item["@type"]) && item["@type"].includes("Recipe"))
        ) {
          return item;
        }
      }
    } catch {
      // Ignore unparsable JSON
    }
  }
  return null;
}

@ApiTags("Recipes")
@Controller("recipes")
export class RecipesController {
  constructor(private readonly aiService: RecipeAiService) {}

  @Post("pricing")
  @HttpCode(HttpStatus.OK)
  @Header("Content-Type", "application/ld+json; charset=utf-8")
  @ApiOperation({
    summary: "Price standard Schema.org Recipe",
    description:
      "Calculates dual pro-rata and supermarket checkout costs across Sri Lankan retailers for a Schema.org Recipe.",
  })
  @ApiResponse({
    status: 200,
    description: "Enriched Schema.org Recipe JSON-LD with item offers and basket totals.",
  })
  async priceRecipe(
    @Body(new ZodValidationPipe(recipePricingRequestSchema))
    recipe: RecipePricingRequest,
  ): Promise<SchemaOrgRecipe> {
    const { options, ...recipeData } = recipe as any;
    return evaluateRecipePricing(recipeData as SchemaOrgRecipe, options);
  }

  @Post("parse-and-price")
  @HttpCode(HttpStatus.OK)
  @Header("Content-Type", "application/ld+json; charset=utf-8")
  @ApiOperation({
    summary: "Import, parse, and price web recipe or text",
    description:
      "Extracts Schema.org JSON-LD (or falls back to Gemini AI), extracts typed HowToSupply ingredients, and computes supermarket pricing.",
  })
  @ApiResponse({
    status: 200,
    description: "Enriched Schema.org Recipe JSON-LD with supermarket pricing.",
  })
  async parseAndPrice(
    @Body(new ZodValidationPipe(parseAndPriceRequestSchema))
    body: ParseAndPriceRequest,
  ): Promise<SchemaOrgRecipe> {
    const { url, rawText, options = {} } = body;

    let recipeName = "Imported Recipe";
    let servings: number | string = 4;
    let imageUrl: string | undefined;
    let rawIngredientStrings: string[] = [];

    if (url) {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
      });

      if (!res.ok) {
        throw new BadRequestException(
          `Could not fetch recipe URL (HTTP ${res.status}: ${res.statusText})`,
        );
      }

      const html = await res.text();
      const jsonLdRecipe = extractRecipeJsonLd(html);

      if (jsonLdRecipe) {
        if (typeof jsonLdRecipe.name === "string" && jsonLdRecipe.name.trim()) {
          recipeName = jsonLdRecipe.name.trim();
        }
        if (
          typeof jsonLdRecipe.recipeYield === "number" ||
          typeof jsonLdRecipe.recipeYield === "string"
        ) {
          servings = jsonLdRecipe.recipeYield;
        }

        const rawImage = jsonLdRecipe.image;
        if (typeof rawImage === "string") {
          imageUrl = rawImage;
        } else if (Array.isArray(rawImage) && typeof rawImage[0] === "string") {
          imageUrl = rawImage[0];
        } else if (
          rawImage &&
          typeof rawImage === "object" &&
          "url" in (rawImage as Record<string, unknown>)
        ) {
          imageUrl = String((rawImage as Record<string, unknown>).url);
        }

        if (Array.isArray(jsonLdRecipe.recipeIngredient)) {
          rawIngredientStrings = jsonLdRecipe.recipeIngredient.map((i: unknown) =>
            typeof i === "string" ? i : (i as { name?: string })?.name || String(i),
          );
        }
      } else {
        const parsedViaAi = await this.aiService.parseCameraRecipe(html.slice(0, 15000));
        if (parsedViaAi) {
          try {
            const parsedObj = JSON.parse(parsedViaAi);
            recipeName = (parsedObj.name as string) || recipeName;
            servings = (parsedObj.recipeYield as number | string) || servings;
            if (Array.isArray(parsedObj.recipeIngredient)) {
              rawIngredientStrings = parsedObj.recipeIngredient;
            }
          } catch {
            // Ignore AI parse failure
          }
        }
      }
    } else if (rawText) {
      const parsedViaAi = await this.aiService.parseCameraRecipe(rawText);
      if (parsedViaAi) {
        try {
          const parsedObj = JSON.parse(parsedViaAi);
          recipeName = (parsedObj.name as string) || "Pasted Recipe";
          servings = (parsedObj.recipeYield as number | string) || servings;
          if (Array.isArray(parsedObj.recipeIngredient)) {
            rawIngredientStrings = parsedObj.recipeIngredient;
          }
        } catch {
          rawIngredientStrings = rawText
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 2);
        }
      } else {
        rawIngredientStrings = rawText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 2);
      }
    }

    if (rawIngredientStrings.length === 0) {
      throw new BadRequestException("No ingredients could be detected in the provided input.");
    }

    const parsedIngredients = await this.aiService.parseIngredientsToSchemaOrg(
      rawIngredientStrings,
    );

    const standardRecipe: SchemaOrgRecipe = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: recipeName,
      recipeYield: servings,
      image: imageUrl,
      recipeIngredient: parsedIngredients.map((item) => ({
        "@type": "HowToSupply",
        name: item.name,
        requiredQuantity: {
          "@type": "QuantitativeValue",
          value: item.quantity?.value ?? 1,
          unitText: item.quantity?.unitText ?? "unit",
        },
      })),
    };

    return evaluateRecipePricing(standardRecipe, options);
  }
}
