import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import { CreateMappingDto, createMappingSchema } from "./dto/mappings.dto";
import { MappingsService } from "./mappings.service";

@ApiTags("Mappings")
@Controller("mapping")
export class MappingsController {
  constructor(private readonly mappingsService: MappingsService) {}

  @Post("create")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Manually map a product to a canonical ingredient" })
  @ApiResponse({ status: 201, description: "Mapping successfully created" })
  async createManualMapping(
    @Body(new ZodValidationPipe(createMappingSchema))
    body: CreateMappingDto,
  ) {
    const result = await this.mappingsService.createManualMapping(
      body.productId,
      body.ingredientId,
      body.override !== false,
    );
    return {
      message: "Mapping created",
      mapping: result,
    };
  }

  @Post("unlink")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Unlink a product from an ingredient" })
  @ApiResponse({ status: 200, description: "Product unlinked" })
  async unlinkProduct(
    @Body() body: { productId: string; ingredientId: string },
  ) {
    const result = await this.mappingsService.unlinkProduct(
      body.productId,
      body.ingredientId,
    );
    return {
      message: "Product unlinked",
      mapping: result,
    };
  }
}
