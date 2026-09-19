import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const createMappingSchema = z.object({
  productId: z.union([z.string().min(1), z.array(z.string().min(1))]),
  ingredientId: z.string().min(1),
  override: z.boolean().optional().default(true),
});

export class CreateMappingDto extends createZodDto(createMappingSchema) {}
