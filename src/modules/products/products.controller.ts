import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import {
  FetchProductsByIdsDto,
  fetchProductsByIdsSchema,
  SearchProductsQueryDto,
  searchProductsQuerySchema,
} from "./dto/products.dto";
import { ProductsService } from "./products.service";

@ApiTags("Products")
@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Search products by name, sku, or ean" })
  async searchProducts(
    @Query(new ZodValidationPipe(searchProductsQuerySchema))
    queryDto: SearchProductsQueryDto,
  ) {
    const result = await this.productsService.searchProducts(
      queryDto.query,
      queryDto.page,
      queryDto.limit,
    );
    return {
      results: result.products,
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Fetch specific products by array of UUIDs" })
  async fetchProductsByIds(
    @Body(new ZodValidationPipe(fetchProductsByIdsSchema))
    body: FetchProductsByIdsDto,
  ) {
    const result = await this.productsService.fetchProductsByIds(body.ids);
    if (result.products.length === 0) {
      throw new NotFoundException("No products found");
    }
    return result;
  }

  @Get("unmapped/random")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Fetch a random unmapped supermarket product" })
  async getRandomUnmappedProduct() {
    const result = await this.productsService.getRandomUnmappedProduct();
    if (!result.product) {
      throw new NotFoundException("No unmapped products found");
    }
    return result;
  }

  @Get(":id/stock-history")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Fetch last 30 days stock sales history" })
  @ApiParam({ name: "id", description: "Product UUID" })
  async getProductStockHistory(@Param("id") id: string) {
    return this.productsService.getProductStockHistory(id);
  }

  @Get(":id/history")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Fetch product price history for charts" })
  @ApiParam({ name: "id", description: "Product UUID" })
  async getProductPriceHistory(@Param("id") id: string) {
    const history = await this.productsService.getProductPriceHistory(id);
    return { history };
  }

}
