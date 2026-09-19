import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import { SearchUsdaQueryDto, searchUsdaQuerySchema } from "./dto/usda.dto";
import { UsdaService } from "./usda.service";

@ApiTags("USDA")
@Controller("usda")
export class UsdaController {
  constructor(private readonly usdaService: UsdaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Search USDA standard reference foods" })
  async searchFoods(
    @Query(new ZodValidationPipe(searchUsdaQuerySchema))
    queryDto: SearchUsdaQueryDto,
  ) {
    const results = await this.usdaService.searchFoods(
      queryDto.query,
      queryDto.limit,
    );
    return { results };
  }
}
