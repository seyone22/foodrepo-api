import { Module } from "@nestjs/common";
import { GraphModule } from "../graph/graph.module";
import { RecipesController } from "./recipes.controller";
import { RecipeAiService } from "./recipe-ai.service";

@Module({
  imports: [GraphModule],
  controllers: [RecipesController],
  providers: [RecipeAiService],
  exports: [RecipeAiService],
})
export class RecipesModule {}
