import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import { RecipeAiService } from "../recipes/recipe-ai.service";
import {
  BulkIngredientsDto,
  bulkIngredientsSchema,
  CreateIngredientDto,
  createIngredientSchema,
  MatchIngredientDto,
  matchIngredientSchema,
  SearchIngredientsQueryDto,
  searchIngredientsQuerySchema,
  EnrichIngredientDto,
  enrichIngredientSchema,
  EnhanceImageDto,
  enhanceImageSchema,
  ParseIngredientsDto,
  parseIngredientsSchema,
  ParseCameraRecipeDto,
  parseCameraRecipeSchema,
} from "./dto/ingredients.dto";
import { IngredientsService } from "./ingredients.service";

@ApiTags("Ingredients")
@Controller("ingredients")
export class IngredientsController {
  constructor(
    private readonly ingredientsService: IngredientsService,
    private readonly aiService: RecipeAiService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Search and list ingredients",
    description:
      "Performs text search (with vector fallback), structured filters (cuisine, country, region, flavor), and pagination.",
  })
  @ApiResponse({ status: 200, description: "Paginated list of ingredients." })
  @ApiResponse({ status: 404, description: "No ingredients found." })
  async searchIngredients(
    @Query(new ZodValidationPipe(searchIngredientsQuerySchema))
    queryDto: SearchIngredientsQueryDto,
  ) {
    const data = await this.ingredientsService.searchIngredients(
      queryDto.query || "",
      {
        page: queryDto.page,
        limit: queryDto.limit,
        autosuggest: queryDto.autosuggest,
        country: queryDto.country,
        cuisine: queryDto.cuisine,
        region: queryDto.region,
        flavor: queryDto.flavor,
        includeProducts: queryDto.includeProducts,
      },
    );

    if (!data.results || data.results.length === 0) {
      throw new NotFoundException("No ingredients found");
    }

    return data;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Add a new canonical ingredient" })
  async addIngredient(
    @Body(new ZodValidationPipe(createIngredientSchema))
    body: CreateIngredientDto,
  ) {
    const ingredient = await this.ingredientsService.addIngredient(body);
    return { message: "Ingredient added", ingredient };
  }

  @Post("bulk")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Fetch multiple ingredients by UUID array" })
  async fetchIngredientsByIds(
    @Body(new ZodValidationPipe(bulkIngredientsSchema))
    body: BulkIngredientsDto,
  ) {
    const result = await this.ingredientsService.fetchIngredientsByIds(body.ids);
    if (result.ingredients.length === 0) {
      throw new NotFoundException("No ingredients found");
    }
    return result;
  }

  @Post("match")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get best semantic match for raw ingredient string" })
  async getBestIngredientMatch(
    @Body(new ZodValidationPipe(matchIngredientSchema))
    body: MatchIngredientDto,
  ) {
    return this.ingredientsService.getBestIngredientMatch(body.query);
  }

  @Get("vector")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Direct vector search for ingredients" })
  async searchIngredientsVector(
    @Query(new ZodValidationPipe(searchIngredientsQuerySchema))
    queryDto: SearchIngredientsQueryDto,
  ) {
    const data = await this.ingredientsService.searchIngredientsVector(
      queryDto.query || "",
      {
        page: queryDto.page,
        limit: queryDto.limit,
        autosuggest: queryDto.autosuggest,
        country: queryDto.country,
        cuisine: queryDto.cuisine,
        region: queryDto.region,
        flavor: queryDto.flavor,
        includeProducts: queryDto.includeProducts,
      },
    );

    if (!data.results || data.results.length === 0) {
      throw new NotFoundException("No ingredients found");
    }

    return data;
  }

  @Post("enhance")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Bulk AI enrichment for ingredients (Collection / Batch Action)",
  })
  @ApiResponse({ status: 200, description: "Bulk enrichment completed." })
  async enhanceIngredients(
    @Body(new ZodValidationPipe(enrichIngredientSchema))
    dto: EnrichIngredientDto,
  ) {
    const ids = Array.isArray(dto.id) ? dto.id : [dto.id];
    const enriched = await this.ingredientsService.enhanceIngredients(ids);
    return { message: "Enhancement completed", enriched };
  }

  @Post("enhance/image")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Image waterfall fetch (Collection / Batch Action)",
  })
  @ApiResponse({ status: 200, description: "Image successfully discovered." })
  @ApiResponse({ status: 404, description: "No image found." })
  async enhanceIngredientImage(
    @Body(new ZodValidationPipe(enhanceImageSchema))
    dto: EnhanceImageDto,
  ) {
    const updated = await this.ingredientsService.enhanceIngredientImage(dto.id);
    if (!updated) {
      throw new NotFoundException("No image found across all providers.");
    }
    return { message: "Success", ingredient: updated };
  }

  @Post("parse")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Parse raw ingredient strings into structured quantities and units",
  })
  @ApiResponse({ status: 200, description: "Structured ingredient items array." })
  async parseIngredients(
    @Body(new ZodValidationPipe(parseIngredientsSchema))
    dto: ParseIngredientsDto,
  ) {
    return this.aiService.parseIngredients(dto.ingredients);
  }

  @Post("parse-recipe")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Convert raw recipe text/OCR into Schema.org Recipe JSON-LD",
  })
  @ApiResponse({ status: 200, description: "Parsed Schema.org Recipe JSON." })
  async parseCameraRecipe(
    @Body(new ZodValidationPipe(parseCameraRecipeSchema))
    dto: ParseCameraRecipeDto,
  ) {
    const recipeJson = await this.aiService.parseCameraRecipeToJsonLd(dto.rawText);
    if (!recipeJson) {
      throw new BadRequestException("Failed to parse recipe text.");
    }
    try {
      return JSON.parse(recipeJson);
    } catch {
      return recipeJson;
    }
  }

  @Get(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get ingredient details by ID",
    description:
      "Retrieves canonical ingredient details, attached products, and USDA nutritional profile.",
  })
  @ApiParam({ name: "id", description: "Ingredient UUID" })
  @ApiQuery({
    name: "includeProducts",
    required: false,
    type: Boolean,
    description: "Whether to include mapped supermarket products",
  })
  @ApiResponse({ status: 200, description: "Ingredient details." })
  @ApiResponse({ status: 404, description: "Ingredient not found." })
  async getIngredientById(
    @Param("id") id: string,
    @Query("includeProducts") includeProducts?: string,
  ) {
    const withProducts = includeProducts === "true";
    const data = await this.ingredientsService.getIngredientById(
      id,
      withProducts,
    );

    if (!data) {
      throw new NotFoundException("Ingredient not found");
    }

    const { products, ...ingredient } = data;

    return {
      ingredient,
      ...(withProducts && { products: products || [] }),
    };
  }

  @Patch(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update ingredient details" })
  @ApiParam({ name: "id", description: "Ingredient UUID" })
  async updateIngredient(@Param("id") id: string, @Body() body: any) {
    const updated = await this.ingredientsService.updateIngredient(id, body);
    if (!updated) {
      throw new NotFoundException("Ingredient not found");
    }
    return { message: "Updated", ingredient: updated };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Delete an ingredient" })
  @ApiParam({ name: "id", description: "Ingredient UUID" })
  async deleteIngredient(@Param("id") id: string) {
    const deleted = await this.ingredientsService.deleteIngredient(id);
    if (!deleted) {
      throw new NotFoundException("Ingredient not found");
    }
    return { message: "Deleted", ingredient: deleted };
  }

  @Get(":id/price")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get supermarket prices and offers for an ingredient",
    description:
      "Returns latest supermarket prices, price history across retail chains, and hierarchy/variety inheritance.",
  })
  @ApiParam({ name: "id", description: "Ingredient UUID" })
  @ApiResponse({
    status: 200,
    description: "Ingredient retail products and latest pricing.",
  })
  @ApiResponse({ status: 404, description: "Ingredient not found." })
  async getIngredientPrices(@Param("id") id: string) {
    const data = await this.ingredientsService.getIngredientPrices(id);

    if (!data) {
      throw new NotFoundException("Ingredient not found");
    }

    return data;
  }

  @Post(":id/enrich")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Enrich single ingredient with AI culinary metadata",
    description: "Generates regional, flavor, dietary, and cultural metadata using Gemini Flash.",
  })
  @ApiParam({ name: "id", description: "Ingredient UUID" })
  @ApiResponse({ status: 200, description: "Enrichment completed." })
  @ApiResponse({ status: 404, description: "Ingredient not found." })
  async enrichSingleIngredient(@Param("id") id: string) {
    const enriched = await this.ingredientsService.enhanceIngredients([id]);
    if (!enriched[id]) {
      throw new NotFoundException("Ingredient not found or enrichment failed.");
    }
    return { message: "Enhancement completed", enriched: enriched[id] };
  }

  @Post(":id/image")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Fetch and score culinary image for single ingredient",
    description: "Runs 4-tier culinary waterfall search across Pexels, Unsplash, Wikimedia, and Open Food Facts.",
  })
  @ApiParam({ name: "id", description: "Ingredient UUID" })
  @ApiResponse({ status: 200, description: "Image successfully discovered and mapped." })
  @ApiResponse({ status: 404, description: "No suitable image found across all providers." })
  async enrichSingleIngredientImage(@Param("id") id: string) {
    const updated = await this.ingredientsService.enhanceIngredientImage(id);
    if (!updated) {
      throw new NotFoundException("No image found across all providers.");
    }
    return { message: "Success", ingredient: updated };
  }
}
