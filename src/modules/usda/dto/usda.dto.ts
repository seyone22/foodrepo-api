import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const searchUsdaQuerySchema = z.object({
  query: z.string().optional().default(""),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 30)),
});

export class SearchUsdaQueryDto extends createZodDto(searchUsdaQuerySchema) {}
