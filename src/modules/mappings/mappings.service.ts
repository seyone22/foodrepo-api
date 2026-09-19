import { Injectable, BadRequestException } from "@nestjs/common";
import { db } from "@/database/database.module";
import { mappings, products, auditLogs } from "@/database/schema";
import { eq } from "drizzle-orm";
import { toPgId } from "@/common/utils/uuid.util";

@Injectable()
export class MappingsService {
  async createManualMapping(productId: string, ingredientId: string) {
    const pgProductId = toPgId(productId);
    const pgIngredientId = toPgId(ingredientId);

    // 1. Create the Pending Audit Log
    const [log] = await db
      .insert(auditLogs)
      .values({
        type: "MANUAL_MAPPING",
        tag: "MANUAL_UI",
        initiatedBy: "admin",
        status: "pending",
        metadata: {
          productId: pgProductId,
          ingredientId: pgIngredientId,
          step: "validation",
        },
      })
      .returning({ id: auditLogs.id });

    try {
      // 2. Verify Product exists
      const productData = await db
        .select({
          id: products.id,
          name: products.name,
          sourceId: products.sourceId,
        })
        .from(products)
        .where(eq(products.id, pgProductId))
        .limit(1);

      if (productData.length === 0) {
        throw new BadRequestException("Product not found");
      }

      const product = productData[0];

      // 3. Check for duplicates
      const existing = await db
        .select({ id: mappings.id })
        .from(mappings)
        .where(eq(mappings.productId, pgProductId))
        .limit(1);

      if (existing.length > 0) {
        throw new BadRequestException("Mapping already exists for this product");
      }

      // 4. Create the mapping
      const [mapping] = await db
        .insert(mappings)
        .values({
          productId: pgProductId,
          matchedIngredients: [pgIngredientId],
          sourceId: product.sourceId,
          confidence: 1.0,
          method: "manual",
          notes: "Mapped via UI Admin Tool",
          meta: { auditLogId: log.id },
        })
        .returning();

      // 5. Update Audit Log to completed
      await db
        .update(auditLogs)
        .set({
          status: "completed",
          message: `Successfully mapped product '${product.name}' (${pgProductId}) to ingredient ${pgIngredientId}`,
          metadata: {
            mappingId: mapping.id,
            productId: pgProductId,
            ingredientId: pgIngredientId,
          },
          endTime: new Date(),
        })
        .where(eq(auditLogs.id, log.id));

      return mapping;
    } catch (err: any) {
      await db
        .update(auditLogs)
        .set({
          status: "failed",
          error: err.message || "Failed to create manual mapping",
          stack: err.stack,
          endTime: new Date(),
        })
        .where(eq(auditLogs.id, log.id));

      throw err;
    }
  }
}
