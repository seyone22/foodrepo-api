import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Query,
  UsePipes,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import {
  SearchIngredientsQueryDto,
  searchIngredientsQuerySchema,
} from "./dto/ingredients.dto";
import { IngredientsService } from "./ingredients.service";

@ApiTags("Ingredients")
@Controller("ingredients")
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

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
}
