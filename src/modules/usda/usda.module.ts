import { Module } from "@nestjs/common";
import { UsdaController } from "./usda.controller";
import { UsdaService } from "./usda.service";

@Module({
  controllers: [UsdaController],
  providers: [UsdaService],
  exports: [UsdaService],
})
export class UsdaModule {}
