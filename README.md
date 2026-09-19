# FoodRepo API (`foodrepo-api`)

[![NestJS](https://img.shields.io/badge/NestJS-11.0-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=flat&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![pgvector](https://img.shields.io/badge/pgvector-3072_dim-0064a5?style=flat)](https://github.com/pgvector/pgvector)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-2.22-4285F4?style=flat&logo=google&logoColor=white)](https://ai.google.dev/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Compliant-8A2BE2?style=flat)](https://modelcontextprotocol.io/)
[![Swagger Docs](https://img.shields.io/badge/Swagger-OpenAPI_3.0-85EA2D?style=flat&logo=swagger&logoColor=black)](https://food.seyone.dev/api/docs)

**FoodRepo API** is an enterprise food intelligence engine, canonical ingredient knowledge graph, and retail supermarket price benchmarking platform built on NestJS and PostgreSQL.

It connects over **20,000+ culinary ingredients** with real-time supermarket product catalogs (Keells, Cargills Online, Glomark, SPAR), semantic vector embeddings, USDA FoodData Central nutritional profiles, and multi-retailer recipe costing algorithms. It also exposes a native **Model Context Protocol (MCP)** server with OAuth 2.0 authentication, enabling AI agents (ChatGPT, Claude Desktop, Google Antigravity, Gemini) to query ingredient intelligence and market prices.

## Core Features

- **Canonical Ingredient Knowledge Graph**
  - Rich culinary taxonomy tracking relationships: `part_of` (botanical/structural components), `varieties` (cultivars/subtypes), `derivatives` (downstream extracts, oils, juices), `substitutes`, and `pairs_with`.
  - Multi-dimensional indexing across country of origin, culinary tradition, regional classifications, and organoleptic flavor profiles.
  - Hybrid search: PostgreSQL full-text fuzzy matching paired with 3072-dimensional vector semantic search via `pgvector` and Gemini embeddings.

- **Supermarket Retail Pricing & Benchmarking**
  - Automated product catalog indexing across major Sri Lankan retail supermarket chains: **Keells**, **Cargills Online**, **Glomark**, and **SPAR**.
  - Historical price and stock tracking (`price_histories`, `stock_histories`) monitoring daily sales velocity, price shifts, and promotional discounts.
  - Unit price normalization (cost per 100g / 100ml) allowing accurate price-per-mass comparisons across different pack sizes and brands.

- **Hierarchical Pricing & Ancestor Fallback**
  - Intelligent multi-tier pricing resolution: Child ingredients resolve direct products first. If unstocked, the engine dynamically ascends the botanical taxonomy tree (`part_of` Level 1 immediate parent $\to$ Level 2+ grandparent) to surface relevant parent products.
  - Dynamic category pills and grouped descendant pricing when querying broader parent ingredients (e.g., querying *Pomegranate* aggregates distinct groups for *Pomegranate Seed*, *Pomegranate Juice*, etc.).

- **Schema.org Recipe Costing & Ingestion**
  - **Dual-Mode Recipe Costing**: Computes both **pro-rata consumed ingredient cost** (exact gram/milliliter fraction required) and **real-world supermarket basket checkout cost** (full retail pack sizes required).
  - Web Recipe Ingestion: Extracts and parses `Schema.org/Recipe` JSON-LD from external recipe URLs.
  - Camera & Text Parser: AI-powered parsing converts unstructured recipe text or OCR camera captures into structured `HowToSupply` items with standard metric quantities and units.

- **USDA FoodData Central Nutrition**
  - Directly linked to USDA FoodData Central (`fdc_id`) records, providing nutritional benchmarks for calories (kcal), macronutrients (protein, fat, carbohydrates), dietary fiber, sodium, and sugars.

- **AI Enrichment & 4-Tier Media Waterfall**
  - Gemini Flash enrichment pipeline auto-populates missing cultural provenance, flavor profiles, phonetic pronunciations, and dietary compliance flags (Vegan, Halal, Gluten-Free).
  - 4-Tier Automated Image Waterfall searches and validates royalty-free culinary imagery across **Pexels**, **Unsplash**, **Wikimedia Commons**, and **Open Food Facts**.

- **Built-in Model Context Protocol (MCP) Server**
  - Standards-compliant MCP endpoint (`/mcp` and `/api/v1/mcp`) with an integrated OAuth 2.0 authorization server (RFC 8414 `.well-known/oauth-authorization-server`).
  - Allows LLMs to autonomously perform semantic ingredient searches, fetch real-time grocery prices, inspect nutritional profiles, and propose ingredient contributions.

## Architecture

```mermaid
flowchart TD
    subgraph Clients["Client Ecosystem"]
        FE["Next.js Web App<br/>(ingredient-database-api)"]
        AI["MCP AI Clients<br/>(Claude Desktop / ChatGPT / Antigravity)"]
        Cron["GitHub Actions<br/>Supermarket Scraper"]
    end

    subgraph NestJS["FoodRepo NestJS API (Port 4000)"]
        direction TB
        MW["CORS & RFC 7807 Problem Details Filter"]
        
        subgraph Modules["API Modules"]
            ING["IngredientsModule<br/>• Full-Text & pgvector Search<br/>• Botanical Taxonomy Graph<br/>• 4-Tier Image Waterfall"]
            PRICING["Pricing & Hierarchy Engine<br/>• Dynamic Categorization<br/>• Level 1 -> 2 Ancestor Fallback<br/>• Store Price Benchmarking"]
            PROD["ProductsModule<br/>• Supermarket Catalogs<br/>• Stock & Price Histories"]
            RECIPE["RecipesModule<br/>• Schema.org JSON-LD Parser<br/>• Dual Basket / Pro-Rata Costing"]
            MAP["MappingsModule<br/>• Product <-> Ingredient Matcher<br/>• Manual & Scored Overrides"]
            MCP_MOD["MCP & OAuth2 Module<br/>• RFC 8414 Discovery<br/>• LLM Tool Executions"]
            ADMIN["AdminModule<br/>• Analytics, Quality & Audit Logs"]
        end
    end

    subgraph Storage["Data Tier (PostgreSQL + pgvector)"]
        PG[("PostgreSQL 16+<br/>Schema: foodrepo")]
        T_ING["ingredients (3072d vector)"]
        T_PROD["products & price_sources"]
        T_HIST["price_histories & stock_histories"]
        T_MAP["mappings"]
        T_USDA["usda_foods"]
        T_LOGS["audit_logs"]
    end

    subgraph External["External Services"]
        GEMINI["Google Gemini API<br/>(Embeddings & Metadata Enrichment)"]
        USDA_EXT["USDA FoodData Central"]
        PEXELS["Image APIs (Pexels / Unsplash / Wikimedia)"]
    end

    FE -->|HTTP / REST| MW
    AI -->|MCP Protocol / SSE / POST| MW
    Cron -->|REST Batch Push| MW

    MW --> Modules
    ING --> PG
    PRICING --> PG
    PROD --> PG
    RECIPE --> PG
    MAP --> PG
    MCP_MOD --> ING
    ADMIN --> PG

    ING -.->|Embeddings & Enrichment| GEMINI
    RECIPE -.->|Recipe Text Extraction| GEMINI
    ING -.->|Photo Resolution| PEXELS
    ING -.->|Nutrition Link| USDA_EXT
```

## API Reference

Interactive OpenAPI / Swagger documentation is available locally at `http://localhost:4000/api/docs` or in production at `https://food.seyone.dev/api/docs`.

### 1. Canonical Ingredients (`/api/v1/ingredients`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/ingredients` | Search and filter ingredients with pagination, cuisine, country, region, and flavor parameters. |
| `GET` | `/api/v1/ingredients/:id` | Fetch canonical ingredient details, attached retail products, and USDA nutritional profile. |
| `GET` | `/api/v1/ingredients/:id/price` | Retrieve supermarket pricing, store breakdown, unit costs, and hierarchical ancestor/descendant prices. |
| `GET` | `/api/v1/ingredients/vector` | Execute direct vector similarity query using 3072-dimensional embeddings. |
| `POST` | `/api/v1/ingredients` | Create a new canonical ingredient with automated vector embedding generation. |
| `POST` | `/api/v1/ingredients/bulk` | Bulk fetch multiple ingredient records by array of UUIDs. |
| `POST` | `/api/v1/ingredients/match` | Perform semantic vector matching for a raw product title or ingredient line. |
| `POST` | `/api/v1/ingredients/enhance` | Trigger batch AI enrichment (provenance, flavor profile, dietary tags) via Gemini. |
| `POST` | `/api/v1/ingredients/:id/enrich`| AI-enrich a single ingredient. |
| `POST` | `/api/v1/ingredients/:id/image` | Run 4-tier automated image waterfall to discover and attach representative photography. |
| `PATCH`| `/api/v1/ingredients/:id` | Update ingredient taxonomy, aliases, varieties, or notes. |
| `DELETE`| `/api/v1/ingredients/:id` | Remove an ingredient from the canonical database. |

### 2. Recipe Costing & Parsing (`/api/v1/recipes`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/recipes/pricing` | Price standard Schema.org Recipe JSON-LD. Calculates dual pro-rata and supermarket checkout totals across Keells, Cargills, and Glomark. |
| `POST` | `/api/v1/recipes/parse-and-price` | Ingest a recipe web URL or raw text string. Automatically extracts Schema.org JSON-LD or parses via Gemini AI, extracts quantities, and returns complete supermarket pricing. |

### 3. Retail Products (`/api/v1/products`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/products` | Search retail supermarket products by name, SKU, or EAN barcode. |
| `POST` | `/api/v1/products` | Fetch specific products by array of UUIDs. |
| `GET` | `/api/v1/products/:id/history` | Retrieve chronological retail price history for charting. |
| `GET` | `/api/v1/products/:id/stock-history`| Retrieve 30-day stock changes and average daily sales. |
| `GET` | `/api/v1/products/unmapped/random` | Fetch a random unmapped supermarket product for human or AI labeling. |

### 4. Product-Ingredient Mappings (`/api/v1/mapping`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/mapping/create` | Manually map a supermarket SKU to a canonical ingredient with optional confidence scoring. |
| `POST` | `/api/v1/mapping/unlink` | Disconnect a product from an ingredient without deleting either record. |

### 5. Admin & Health (`/api/v1/admin`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/admin/stats` | High-level repository statistics (ingredient count, mapped products, price records). |
| `GET` | `/api/v1/admin/analytics` | Taxonomy and retail source distribution breakdown. |
| `GET` | `/api/v1/admin/quality` | Ingredient metadata quality audit (missing images, missing varieties, missing nutrition). |
| `GET` | `/api/v1/admin/logs` | Query structured audit logs with pagination and status filters. |
| `POST` | `/api/v1/admin/scraper/run` | Dispatch repository dispatch event to trigger automated GitHub Actions scrapers. |

## Database Schema (`foodrepo`)

All tables are encapsulated within the custom `foodrepo` PostgreSQL schema managed via **Drizzle ORM**:

```
foodrepo
 ingredients         # 20k+ canonical ingredients, 3072d vectors, taxonomy arrays
 products            # Supermarket SKUs, prices, brands, barcodes, store departments
 price_sources       # Supermarket chains (Keells, Cargills, Glomark, SPAR)
 mappings            # Junction linking products to canonical ingredient UUIDs
 price_histories     # Time-series log of supermarket price adjustments
 stock_histories     # Time-series log of supermarket inventory levels
 usda_foods          # Nutritional reference data from USDA FoodData Central
 audit_logs          # Operational & enrichment job audit trail
 query_embeddings    # Semantic query cache with 1536d / 3072d vectors
```

### Key Indexes
- **Vector Search**: `pgvector` index on `foodrepo.ingredients(embedding)` for nearest-neighbor semantic search.
- **Taxonomy Arrays**: GIN indexes on `part_of`, `aliases`, `cuisine`, and `country` for fast subset queries.
- **Composite Unique Keys**: `(external_id, source_id)` on `products` and `(product_id, source_id)` on `mappings`.

## Model Context Protocol (MCP)

FoodRepo API implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) specification, exposing tools directly to LLMs.

### Available MCP Tools

1. `search_ingredients`: Search canonical ingredients across aliases, cuisines, countries, and flavor profiles.
2. `get_ingredient_details`: Retrieve full canonical specification, nutrition facts, and mapped supermarket products.
3. `get_ingredient_prices`: Fetch real-time supermarket prices, pack sizes, and availability across chains.
4. `match_ingredient`: Semantic vector matching to resolve raw recipe text to canonical records.
5. `contribute_ingredient`: Add newly discovered ingredients with automated vector embedding generation.
6. `update_ingredient`: Update taxonomy, dietary flags, or culinary metadata.

### Connecting Claude Desktop

Add the following to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "foodrepo": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://food.seyone.dev/mcp",
        "--header",
        "Authorization: Bearer YOUR_MCP_API_KEY"
      ]
    }
  }
}
```

## Environment Configuration

Create a `.env` file in the root directory:

```env
# Server
PORT=4000
NODE_ENV=development

# Database (PostgreSQL with pgvector enabled)
DATABASE_URL=postgresql://user:password@localhost:5432/foodrepo?sslmode=require

# Google Gemini API (Embeddings & Culinary AI Enrichment)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# Image Waterfall API Keys (Optional)
PEXELS_API_KEY=your_pexels_api_key_here

# MCP & OAuth Authentication (Optional / Production)
MCP_API_KEY=your_secure_mcp_api_key
MCP_JWT_SECRET=your_super_secret_jwt_key
MCP_CLIENT_SECRET=your_client_secret
NEXT_PUBLIC_APP_URL=https://food.seyone.dev

# GitHub Actions Workflow Trigger (Optional for Admin Scraper Run)
GITHUB_TOKEN=ghp_your_github_personal_access_token
```

## Getting Started

### Prerequisites
- **Node.js**: v20.x or higher
- **PostgreSQL**: v16+ with the `vector` extension installed (`CREATE EXTENSION IF NOT EXISTS vector;`)
- **Package Manager**: npm or pnpm

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/seyone22/foodrepo-api.git
   cd foodrepo-api
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your PostgreSQL DATABASE_URL and GEMINI_API_KEY
   ```

4. **Start development server**:
   ```bash
   npm run start:dev
   ```

   The server will start at:
   - API Base: `http://localhost:4000/api/v1`
   - Swagger Docs: `http://localhost:4000/api/docs`
   - MCP Endpoint: `http://localhost:4000/mcp`

### Build & Production

```bash
# Build the application
npm run build

# Run in production mode
npm run start:prod
```

### Testing & Quality

```bash
# Run unit tests
npm run test

# Run end-to-end tests
npm run test:e2e

# Run linter
npm run lint

# Format codebase
npm run format
```

## Related Projects

- **[ingredient-database-api](https://github.com/seyone22/ingredient-database-api)**: Next.js frontend web application consuming FoodRepo API.

## License

This project is licensed under the [UNLICENSED](LICENSE) agreement. All rights reserved.
