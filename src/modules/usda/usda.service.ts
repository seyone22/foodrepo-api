import { Injectable } from "@nestjs/common";
import { db } from "@/database/database.module";
import { usdaFoods } from "@/database/schema";
import { and, desc, ilike, sql } from "drizzle-orm";

@Injectable()
export class UsdaService {
  async searchFoods(query: string = "", limit: number = 30) {
    const clean = query.trim();
    if (!clean || clean.length < 2) {
      return [];
    }

    const tokens = clean.split(/\s+/).filter(Boolean);
    const whereClause =
      tokens.length > 1
        ? and(...tokens.map((t) => ilike(usdaFoods.description, `%${t}%`)))
        : ilike(usdaFoods.description, `%${clean}%`);

    const isStartsWith = sql<number>`CASE WHEN ${usdaFoods.description} ILIKE ${clean + "%"} THEN 1 ELSE 0 END`;

    const results = await db
      .select({
        fdcId: usdaFoods.fdcId,
        description: usdaFoods.description,
        foodCategory: usdaFoods.foodCategory,
        caloriesKcal: usdaFoods.caloriesKcal,
        proteinG: usdaFoods.proteinG,
        fatG: usdaFoods.fatG,
        carbsG: usdaFoods.carbsG,
        fiberG: usdaFoods.fiberG,
        sodiumMg: usdaFoods.sodiumMg,
        sugarG: usdaFoods.sugarG,
      })
      .from(usdaFoods)
      .where(whereClause)
      .orderBy(desc(isStartsWith), usdaFoods.description)
      .limit(limit);

    return results;
  }
}
