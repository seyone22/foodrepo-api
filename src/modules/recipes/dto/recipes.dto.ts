import { z } from "zod";
import {
  recipePricingRequestSchema,
  type RecipePricingOptions,
  type PricingStrategy,
} from "./recipePricing.dto";

export const recipeOptionsSchema = z.object({
  strategy: z
    .enum([
      "cheapest",
      "cheapest_basket",
      "cheapest_per_unit",
      "cheapest_pro_rata",
      "cheapest_single_store",
      "expensive",
    ])
    .optional()
    .default("cheapest"),
  servings: z.number().positive().optional(),
  sources: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

export const parseAndPriceRequestSchema = z
  .object({
    url: z.string().url("Must be a valid URL").optional(),
    rawText: z.string().min(3, "Raw text must be at least 3 characters").optional(),
    options: recipeOptionsSchema.optional(),
  })
  .refine((data) => data.url || data.rawText, {
    message: "Either 'url' or 'rawText' must be provided",
  });

export type ParseAndPriceRequest = z.infer<typeof parseAndPriceRequestSchema>;
export type RecipePricingRequest = z.infer<typeof recipePricingRequestSchema>;
