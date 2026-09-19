import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { IngredientsModule } from "./modules/ingredients/ingredients.module";
import { ProductsModule } from "./modules/products/products.module";
import { MappingsModule } from "./modules/mappings/mappings.module";
import { UsdaModule } from "./modules/usda/usda.module";
import { AdminModule } from "./modules/admin/admin.module";
import { RecipesModule } from "./modules/recipes/recipes.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    IngredientsModule,
    ProductsModule,
    MappingsModule,
    UsdaModule,
    AdminModule,
    RecipesModule,
  ],
})
export class AppModule {}
