import { Module } from "@nestjs/common";
import { RecipesModule } from "../recipes/recipes.module";
import { IngredientsController } from "./ingredients.controller";
import { IngredientsService } from "./ingredients.service";
import { ImageWaterfallService } from "./image-waterfall.service";

@Module({
  imports: [RecipesModule],
  controllers: [IngredientsController],
  providers: [IngredientsService, ImageWaterfallService],
  exports: [IngredientsService, ImageWaterfallService],
})
export class IngredientsModule {}
