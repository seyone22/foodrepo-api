import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema.org TypeScript Definitions
// ---------------------------------------------------------------------------

export interface QuantitativeValue {
  "@type"?: "QuantitativeValue";
  value: number;
  unitText?: string;
  unitCode?: string;
}

export interface UnitPriceSpecification {
  "@type"?: "UnitPriceSpecification";
  name?: string;
  price: number;
  priceCurrency: string;
  referenceQuantity?: QuantitativeValue;
}

export interface ProductOffered {
  "@type"?: "Product";
  name: string;
  sku?: string | null;
  url?: string | null;
  brand?: string | null;
  image?: string | null;
}

export interface SellerOrganization {
  "@type"?: "Organization";
  name: string;
  identifier?: string;
}

export interface Offer {
  "@type"?: "Offer";
  seller?: SellerOrganization;
  itemOffered?: ProductOffered;
  price: number;
  priceCurrency: string;
  availability?: string;
  priceSpecification?: UnitPriceSpecification;
  // Extension properties for grocery checkout
  packsNeeded?: number;
  recipeCost?: number;
  basketCost?: number;
}

export interface SupplyFulfillment {
  strategy: "direct" | "derivative" | "child" | "parent" | "ancestor";
  sourceIngredient?: string;
  sourceIngredientId?: string;
  process?: string | null;
  yieldRatio?: number | null;
  lossRatio?: number | null;
  adjustedQuantity?: QuantitativeValue;
  note?: string;
}

export interface HowToSupply {
  "@type"?: "HowToSupply";
  name: string;
  identifier?: string | null; // Canonical FoodRepo UUID if known
  requiredQuantity?: QuantitativeValue;
  offers?: Offer[];
  status?: "priced" | "unpriced" | "excluded";
  note?: string;
  fulfillment?: SupplyFulfillment;
}

export interface AggregateOffer {
  "@type"?: "AggregateOffer";
  priceCurrency: string;
  lowPrice: number;
  highPrice: number;
  offerCount: number;
  priceSpecification?: UnitPriceSpecification[];
}

export interface StoreBreakdown {
  storeName: string;
  itemCount: number;
  recipeSubtotal: number;
  basketSubtotal: number;
  missingItems: string[];
}

export interface SchemaOrgRecipe {
  "@context"?: string;
  "@type": "Recipe";
  name: string;
  recipeYield?: number | string;
  image?: string | null;
  recipeIngredient: HowToSupply[];
  offers?: AggregateOffer;
  storeBreakdown?: Record<string, StoreBreakdown>;
}

// ---------------------------------------------------------------------------
// Pricing Engine Options
// ---------------------------------------------------------------------------

export type PricingStrategy =
  | "cheapest"
  | "expensive"
  | "cheapest_single_store";

export interface RecipePricingOptions {
  strategy?: PricingStrategy;
  sources?: string[];
  servings?: number;
  exclude?: string[];
}

// ---------------------------------------------------------------------------
// Zod Validation Schemas
// ---------------------------------------------------------------------------

export const quantitativeValueSchema = z.object({
  "@type": z
    .literal("QuantitativeValue")
    .optional()
    .default("QuantitativeValue"),
  value: z.number().positive("Quantity value must be positive"),
  unitText: z.string().optional().default("unit"),
  unitCode: z.string().optional(),
});

export const howToSupplyInputSchema = z.object({
  "@type": z.literal("HowToSupply").optional().default("HowToSupply"),
  name: z.string().min(1, "Ingredient name is required"),
  identifier: z.string().min(1).nullable().optional(),
  requiredQuantity: quantitativeValueSchema.optional(),
});

export const recipePricingRequestSchema = z.object({
  "@context": z.string().optional().default("https://schema.org"),
  "@type": z.literal("Recipe"),
  name: z.string().min(1, "Recipe name is required"),
  recipeYield: z.union([z.number().positive(), z.string()]).optional(),
  recipeIngredient: z
    .array(howToSupplyInputSchema)
    .min(1, "At least one recipeIngredient is required"),
});

export type RecipePricingRequestInput = z.infer<
  typeof recipePricingRequestSchema
>;
