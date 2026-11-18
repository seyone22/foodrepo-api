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

const hexUuidRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const ingredientLinkSchema = z.object({
  id: z.string().regex(hexUuidRegex, "Invalid UUID").optional().nullable(),
  name: z.string().min(1).max(200),
});

export const ingredientLinkInputSchema = z.union([
  ingredientLinkSchema.transform((obj) => ({
    id: obj.id ?? null,
    name: obj.name.trim(),
  })),
  z
    .string()
    .min(1)
    .max(200)
    .transform((val) => {
      const trimmed = val.trim();
      if (hexUuidRegex.test(trimmed)) {
        return { id: trimmed, name: trimmed };
      }
      return { id: null, name: trimmed };
    }),
]);

export const derivativeItemSchema = z.object({
  name: z.string().min(1),
  targetId: z.string().uuid().optional().nullable(),
  process: z.string().optional().nullable(),
  yieldRatio: z.number().positive().optional().nullable(),
  lossRatio: z.number().nonnegative().optional().nullable(),
});

export const derivativeInputSchema = z.union([
  derivativeItemSchema,
  z.string().min(1).transform((name) => ({
    name,
    targetId: null,
    process: null,
    yieldRatio: null,
    lossRatio: null,
  })),
]);

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
  derivatives: z.array(derivativeInputSchema).optional().default([]),
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

export const enrichIngredientSchema = z.object({
  id: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
});

export class EnrichIngredientDto extends createZodDto(enrichIngredientSchema) {}

export const enhanceImageSchema = z.object({
  id: z.string().min(1),
});

export class EnhanceImageDto extends createZodDto(enhanceImageSchema) {}

export const parseIngredientsSchema = z.object({
  ingredients: z.array(z.string().min(1)).min(1),
});

export class ParseIngredientsDto extends createZodDto(parseIngredientsSchema) {}

export const parseCameraRecipeSchema = z.object({
  rawText: z.string().min(1),
});

export class ParseCameraRecipeDto extends createZodDto(parseCameraRecipeSchema) {}

export const updateIngredientSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    aliases: z.array(z.string().min(1).max(200)).optional(),
    country: z.array(z.string().min(1).max(100)).optional(),
    cuisine: z.array(z.string().min(1).max(100)).optional(),
    region: z.array(z.string().min(1).max(100)).optional(),
    flavorProfile: z.array(z.string().min(1).max(100)).optional(),
    dietaryFlags: z.array(z.string().min(1).max(100)).optional(),
    provenance: z.string().min(1).max(100).optional(),
    comment: z.string().max(5000).nullable().optional(),
    pronunciation: z.string().max(300).nullable().optional(),
    fdcId: z.number().int().positive().nullable().optional(),
    partOf: z.array(ingredientLinkInputSchema).optional(),
    derivatives: z.array(derivativeInputSchema).optional(),
    varieties: z.array(ingredientLinkInputSchema).optional(),
    usedIn: z.array(z.string().min(1).max(200)).optional(),
    substitutes: z.array(ingredientLinkInputSchema).optional(),
    pairsWith: z.array(ingredientLinkInputSchema).optional(),
    density: z.number().positive().max(25).nullable().optional(),
    reviewStatus: z.enum(["flagged", "verified", "needs_review"]).nullable().optional(),
    reviewReason: z.string().max(1000).nullable().optional(),
    expectedUpdatedAt: z
      .union([z.string().min(1), z.number().finite()])
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).some((k) => k !== "expectedUpdatedAt"),
    {
      message: "At least one updatable field must be provided",
    },
  );

export class UpdateIngredientDto extends createZodDto(updateIngredientSchema) {}

export const linkVarietySchema = z
  .object({
    varietyId: z.string().regex(hexUuidRegex, "Invalid UUID").optional(),
    id: z.string().regex(hexUuidRegex, "Invalid UUID").optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.varietyId || data.id || data.name), {
    message: "varietyId, id, or name must be provided",
  });

export class LinkVarietyDto extends createZodDto(linkVarietySchema) {}

export const linkPartOfSchema = z
  .object({
    parentId: z.string().regex(hexUuidRegex, "Invalid UUID").optional(),
    id: z.string().regex(hexUuidRegex, "Invalid UUID").optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.parentId || data.id || data.name), {
    message: "parentId, id, or name must be provided",
  });

export class LinkPartOfDto extends createZodDto(linkPartOfSchema) {}

export const claimIngredientsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  claimMinutes: z.coerce.number().int().min(1).max(120).optional().default(10),
  reviewStatus: z.enum(["flagged", "verified", "needs_review"]).optional(),
  provenance: z.string().min(1).max(100).optional(),
});

export class ClaimIngredientsDto extends createZodDto(claimIngredientsSchema) {}

export const mergeIngredientsSchema = z
  .object({
    sourceId: z.string().regex(hexUuidRegex, "Invalid UUID"),
    targetId: z.string().regex(hexUuidRegex, "Invalid UUID"),
    addSourceNameAsAlias: z.boolean().optional().default(true),
  })
  .strict()
  .refine((data) => data.sourceId !== data.targetId, {
    message: "sourceId and targetId must be different",
  });

export class MergeIngredientsDto extends createZodDto(mergeIngredientsSchema) {}


