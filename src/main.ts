import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { ProblemDetailsFilter } from "./common/filters/problem-details.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend clients
  app.enableCors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  });

  // Global RFC 7807 problem details filter
  app.useGlobalFilters(new ProblemDetailsFilter());

  // Global API Prefix
  app.setGlobalPrefix("api/v1");

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
