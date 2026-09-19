import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const getAuditLogsQuerySchema = z.object({
  type: z.string().optional(),
  tag: z.string().optional(),
  status: z.string().optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50)),
});

export class GetAuditLogsQueryDto extends createZodDto(getAuditLogsQuerySchema) {}
