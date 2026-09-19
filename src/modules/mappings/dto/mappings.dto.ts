import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const createMappingSchema = z.object({
  productId: z.string().min(1),
  ingredientId: z.string().min(1),
});

export class CreateMappingDto extends createZodDto(createMappingSchema) {}
