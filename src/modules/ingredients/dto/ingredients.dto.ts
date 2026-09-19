import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const searchIngredientsQuerySchema = z.object({
  query: z.string().optional().default(""),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20)),
  autosuggest: z
    .string()
    .optional()
    .transform((val) => val === "true"),
  includeProducts: z
    .string()
    .optional()
    .transform((val) => val === "true"),
  country: z.string().optional(),
  cuisine: z.string().optional(),
  region: z.string().optional(),
  flavor: z.string().optional(),
});

export class SearchIngredientsQueryDto extends createZodDto(
  searchIngredientsQuerySchema,
) {}

export const createIngredientSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional().default([]),
  country: z.array(z.string()).optional().default([]),
  cuisine: z.array(z.string()).optional().default([]),
  region: z.array(z.string()).optional().default([]),
  flavor_profile: z.array(z.string()).optional().default([]),
  dietary_flags: z.array(z.string()).optional().default([]),
  provenance: z.string().optional().default("MISSING"),
  comment: z.string().optional(),
  pronunciation: z.string().optional(),
  photo: z.string().optional(),
});

export class CreateIngredientDto extends createZodDto(createIngredientSchema) {}

export const bulkIngredientsSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export class BulkIngredientsDto extends createZodDto(bulkIngredientsSchema) {}

export const matchIngredientSchema = z.object({
  query: z.string().min(1),
});

export class MatchIngredientDto extends createZodDto(matchIngredientSchema) {}
