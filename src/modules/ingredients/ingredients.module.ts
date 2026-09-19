import { Module } from "@nestjs/common";
import { RecipesModule } from "../recipes/recipes.module";
import { GraphModule } from "../graph/graph.module";
import { IngredientsController } from "./ingredients.controller";
import { IngredientsService } from "./ingredients.service";
import { ImageWaterfallService } from "./image-waterfall.service";

@Module({
  imports: [RecipesModule, GraphModule],
  controllers: [IngredientsController],
  providers: [IngredientsService, ImageWaterfallService],
  exports: [IngredientsService, ImageWaterfallService],
})
export class IngredientsModule {}
