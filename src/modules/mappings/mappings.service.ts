import { Injectable, BadRequestException } from "@nestjs/common";
import { db } from "@/database/database.module";
import { mappings, products, auditLogs } from "@/database/schema";
import { eq } from "drizzle-orm";
import { toPgId } from "@/common/utils/uuid.util";

@Injectable()
export class MappingsService {
  async createManualMapping(
    productIdInput: string | string[],
    ingredientId: string,
    override: boolean = true,
  ) {
    const rawIds = Array.isArray(productIdInput)
      ? productIdInput
      : [productIdInput];
    const productIds = rawIds.filter(Boolean);

    if (productIds.length === 0) {
      throw new BadRequestException("At least one productId is required");
    }

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
          productIds,
          ingredientId: pgIngredientId,
          override,
          step: "validation",
        },
      })
      .returning({ id: auditLogs.id });

    try {
      const results: any[] = [];
      let overriddenCount = 0;
      let newlyCreatedCount = 0;

      for (const rawPid of productIds) {
        const pgProductId = toPgId(rawPid);

        // 2. Verify Product exists
        const [product] = await db
          .select({
            id: products.id,
            name: products.name,
            sourceId: products.sourceId,
          })
          .from(products)
          .where(eq(products.id, pgProductId))
          .limit(1);

        if (!product) {
          throw new BadRequestException(`Product ${rawPid} not found`);
        }

        // 3. Check for existing mapping
        const [existing] = await db
          .select({
            id: mappings.id,
            matchedIngredients: mappings.matchedIngredients,
          })
          .from(mappings)
          .where(eq(mappings.productId, pgProductId))
          .limit(1);

        if (existing) {
          if (!override) {
            throw new BadRequestException(
              `Mapping already exists for product '${product.name}'`,
            );
          }

          // Update existing mapping (override)
          const [updated] = await db
            .update(mappings)
            .set({
              matchedIngredients: [pgIngredientId],
              confidence: 1.0,
              method: "manual",
              notes: "Overridden via UI Admin Tool",
              updatedAt: new Date(),
            })
            .where(eq(mappings.id, existing.id))
            .returning();

          results.push(updated);
          overriddenCount++;
        } else {
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

          results.push(mapping);
          newlyCreatedCount++;
        }
      }

      // 5. Update Audit Log to completed
      await db
        .update(auditLogs)
        .set({
          status: "completed",
          message: `Mapped ${results.length} product(s) to ingredient ${pgIngredientId} (new: ${newlyCreatedCount}, overridden: ${overriddenCount})`,
          metadata: {
            ingredientId: pgIngredientId,
            totalMapped: results.length,
            newlyCreatedCount,
            overriddenCount,
          },
          endTime: new Date(),
        })
        .where(eq(auditLogs.id, log.id));

      return Array.isArray(productIdInput) ? results : results[0];
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

  async unlinkProduct(productId: string, ingredientId: string) {
    const pgProductId = toPgId(productId);
    const pgIngredientId = toPgId(ingredientId);

    const [existing] = await db
      .select({
        id: mappings.id,
        matchedIngredients: mappings.matchedIngredients,
      })
      .from(mappings)
      .where(eq(mappings.productId, pgProductId))
      .limit(1);

    if (!existing) {
      return null;
    }

    const filtered = (existing.matchedIngredients || []).filter(
      (id) => id !== pgIngredientId,
    );

    const [updated] = await db
      .update(mappings)
      .set({
        matchedIngredients: filtered,
        notes: "Unlinked via UI Admin Tool",
        updatedAt: new Date(),
      })
      .where(eq(mappings.id, existing.id))
      .returning();

    return updated;
  }
}
