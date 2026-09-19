import { Injectable } from "@nestjs/common";
import { db } from "@/database/database.module";
import { usdaFoods } from "@/database/schema";
import { ilike, sql, desc } from "drizzle-orm";

@Injectable()
export class UsdaService {
  async searchFoods(query: string = "", limit: number = 30) {
    const clean = query.trim();
    if (!clean || clean.length < 2) {
      return [];
    }

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
      .where(ilike(usdaFoods.description, `%${clean}%`))
      .orderBy(desc(isStartsWith), usdaFoods.description)
      .limit(limit);

    return results;
  }
}
