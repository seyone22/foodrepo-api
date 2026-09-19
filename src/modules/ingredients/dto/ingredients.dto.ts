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
