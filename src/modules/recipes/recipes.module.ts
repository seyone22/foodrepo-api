import { Module } from "@nestjs/common";
import { RecipesController } from "./recipes.controller";
import { RecipeAiService } from "./recipe-ai.service";

@Module({
  controllers: [RecipesController],
  providers: [RecipeAiService],
  exports: [RecipeAiService],
})
export class RecipesModule {}
