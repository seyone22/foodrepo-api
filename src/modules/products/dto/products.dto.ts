import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const searchProductsQuerySchema = z.object({
  query: z.string().optional().default(""),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 25)),
});

export class SearchProductsQueryDto extends createZodDto(
  searchProductsQuerySchema,
) {}

export const fetchProductsByIdsSchema = z.object({
  ids: z.array(z.string()).min(1),
});

export class FetchProductsByIdsDto extends createZodDto(
  fetchProductsByIdsSchema,
) {}
