import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { ProblemDetailsFilter } from "./common/filters/problem-details.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend clients & MCP callers
  app.enableCors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders:
      "Authorization, Content-Type, Mcp-Method, Mcp-Name, Mcp-Session-Id",
  });

  // Global RFC 7807 problem details filter
  app.useGlobalFilters(new ProblemDetailsFilter());

  // Global API Prefix (excluding .well-known for standard discovery)
  app.setGlobalPrefix("api/v1", {
    exclude: [
      ".well-known/oauth-authorization-server",
      ".well-known/oauth-protected-resource",
      ".well-known/openid-configuration",
    ],
  });

  // OpenAPI / Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle("FoodRepo API")
    .setDescription(
      "Enterprise Sri Lankan Supermarket Ingredient Database & Schema.org Recipe Pricing API",
    )
    .setVersion("1.0.0")
    .addTag("Recipes", "Schema.org recipe pricing & web ingestion engine")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`🚀 FoodRepo API running at: http://localhost:${port}/api/v1`);
  console.log(`📖 Swagger documentation at: http://localhost:${port}/api/docs`);
}
bootstrap();
