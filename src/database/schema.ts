import {
  pgSchema,
  text,
  varchar,
  timestamp,
  jsonb,
  uuid,
  real,
  doublePrecision,
  boolean,
  index,
  uniqueIndex,
  vector,
  integer,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ----------------------------------------------------------------------
// DEFINE CUSTOM POSTGRES SCHEMA
// ----------------------------------------------------------------------
export const foodrepo = pgSchema("foodrepo");

// ----------------------------------------------------------------------
// ENUMS (Scoped to the custom schema)
// ----------------------------------------------------------------------
export const auditStatusEnum = foodrepo.enum("audit_status", [
  "pending",
  "completed",
  "failed",
  "partial_success",
]);
export const sourceTypeEnum = foodrepo.enum("source_type", ["api", "scraper"]);

// ----------------------------------------------------------------------
// TABLES (Scoped to the custom schema)
// ----------------------------------------------------------------------

export const auditLogs = foodrepo.table(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: varchar("type").notNull(),
    tag: varchar("tag").notNull(),
    status: auditStatusEnum("status").default("pending"),
    initiatedBy: varchar("initiated_by").default("system"),
    startTime: timestamp("start_time").defaultNow(),
    endTime: timestamp("end_time"),
    message: text("message"),
    metadata: jsonb("metadata").default({}),
    error: text("error"),
    stack: text("stack"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_type_idx").on(table.type),
    index("audit_tag_idx").on(table.tag),
    index("audit_status_idx").on(table.status),
  ],
);

export const usdaFoods = foodrepo.table("usda_foods", {
  fdcId: integer("fdc_id").primaryKey(),
  description: text("description").notNull(),
  foodCategory: text("food_category"),
  caloriesKcal: real("calories_kcal"),
  proteinG: real("protein_g"),
  fatG: real("fat_g"),
  carbsG: real("carbs_g"),
  fiberG: real("fiber_g"),
  sodiumMg: real("sodium_mg"),
  sugarG: real("sugar_g"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ingredients = foodrepo.table("ingredients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  aliases: text("aliases").array(),
  country: text("country").array(),
  cuisine: text("cuisine").array(),
  region: text("region").array(),
  flavorProfile: text("flavor_profile").array(),
  dietaryFlags: text("dietary_flags").array(),
  provenance: text("provenance").default("MISSING"),
  comment: text("comment"),
  pronunciation: text("pronunciation"),
  lastModified: timestamp("last_modified").defaultNow(),

  // Link to USDA Food
  fdcId: integer("fdc_id").references(() => usdaFoods.fdcId),

  // NOTE: Adjust 1536 to match your exact vector dimension output
  embedding: vector("embedding", { dimensions: 3072 }),

  // Subdocuments mapped to JSONB
  image: jsonb("image")
    .$type<{
      url?: string;
      license?: string;
      author?: string;
      source?: string;
      missing?: boolean;
    }>()
    .default({ missing: true }),

  partOf: text("part_of").array(),
  derivatives: text("derivatives").array(),
  varieties: text("varieties").array(),
  usedIn: text("used_in").array(),
  substitutes: text("substitutes").array(),
  pairsWith: text("pairs_with").array(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const priceSources = foodrepo.table("price_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  country: text("country").notNull(),
  logo: text("logo"),
  baseUrl: text("base_url"),
  type: sourceTypeEnum("type").default("api"),
  lastFetch: timestamp("last_fetch"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const products = foodrepo.table(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sourceId: uuid("source_id")
      .references(() => priceSources.id)
      .notNull(),
    brand: text("brand"),
    unit: text("unit"),
    quantity: real("quantity").default(1),
    price: doublePrecision("price").notNull(),
    currency: varchar("currency", { length: 3 }).default("LKR"),
    lastFetched: timestamp("last_fetched").defaultNow(),
    url: text("url"),
    externalId: text("external_id"),
    departmentCode: text("department_code"),

    // Advanced Market Data
    stockInHand: real("stock_in_hand"),
    averageSale: real("average_sale"),
    maxQty: real("max_qty"),
    categoryPath: text("category_path").array(),
    subDepartmentCode: text("sub_department_code"),
    isPromotionApplied: boolean("is_promotion_applied"),
    promotionDiscountValue: doublePrecision("promotion_discount_value"),
    sku: text("sku"),
    raw: text("raw"),

    // Expanded Metadata
    eanBarcode: text("ean_barcode"),
    mrp: doublePrecision("mrp"),
    dietaryType: text("dietary_type"),
    packSize: integer("pack_size"),
    searchTerms: text("search_terms").array(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("product_external_source_idx").on(
      table.externalId,
      table.sourceId,
    ),
    index("product_sku_idx").on(table.sku),
    index("product_ean_barcode_idx").on(table.eanBarcode),
  ],
);

export const mappings = foodrepo.table(
  "mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),

    matchedIngredients: uuid("matched_ingredients").array(),

    confidence: real("confidence"),
    method: text("method").default("manual"),
    notes: text("notes"),
    meta: jsonb("meta"),

    sourceId: uuid("source_id").references(() => priceSources.id),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("mapping_product_source_idx").on(
      table.productId,
      table.sourceId,
    ),
  ],
);

export const priceHistories = foodrepo.table(
  "price_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),
    price: doublePrecision("price").notNull(),
    currency: varchar("currency", { length: 3 }).default("LKR"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  (table) => [
    index("price_hist_prod_time_idx").on(table.productId, table.timestamp),
  ],
);

export const stockHistories = foodrepo.table(
  "stock_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .references(() => products.id)
      .notNull(),
    stock: real("stock").notNull(),
    averageDailySales: real("average_daily_sales"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  (table) => [
    index("stock_hist_prod_time_idx").on(table.productId, table.timestamp),
  ],
);

export const queryEmbeddings = foodrepo.table("query_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  query: text("query").notNull().unique(),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ----------------------------------------------------------------------
// RELATIONS
// ----------------------------------------------------------------------

export const ingredientRelations = relations(ingredients, ({ one }) => ({
  nutrition: one(usdaFoods, {
    fields: [ingredients.fdcId],
    references: [usdaFoods.fdcId],
  }),
}));

export const usdaFoodsRelations = relations(usdaFoods, ({ many }) => ({
  ingredients: many(ingredients),
}));

export const priceSourceRelations = relations(priceSources, ({ many }) => ({
  products: many(products),
}));

export const productRelations = relations(products, ({ one, many }) => ({
  source: one(priceSources, {
    fields: [products.sourceId],
    references: [priceSources.id],
  }),
  priceHistories: many(priceHistories),
  stockHistories: many(stockHistories),
  mappings: many(mappings),
}));

export const mappingRelations = relations(mappings, ({ one }) => ({
  product: one(products, {
    fields: [mappings.productId],
    references: [products.id],
  }),
}));

export const priceHistoryRelations = relations(priceHistories, ({ one }) => ({
  product: one(products, {
    fields: [priceHistories.productId],
    references: [products.id],
  }),
}));

export const stockHistoryRelations = relations(stockHistories, ({ one }) => ({
  product: one(products, {
    fields: [stockHistories.productId],
    references: [products.id],
  }),
}));
