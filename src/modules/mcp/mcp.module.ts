import { Module } from "@nestjs/common";
import { IngredientsModule } from "../ingredients/ingredients.module";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";
import { OAuthController } from "./oauth.controller";
import { WellKnownController } from "./well-known.controller";

@Module({
  imports: [IngredientsModule],
  controllers: [McpController, OAuthController, WellKnownController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
