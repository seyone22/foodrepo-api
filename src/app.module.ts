import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { IngredientsModule } from "./modules/ingredients/ingredients.module";
import { RecipesModule } from "./modules/recipes/recipes.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    IngredientsModule,
    RecipesModule,
  ],
})
export class AppModule {}
