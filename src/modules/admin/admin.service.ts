import { Injectable } from "@nestjs/common";
import { db } from "@/database/database.module";
import {
  ingredients,
  mappings,
  products,
  priceSources,
  auditLogs,
  usdaFoods,
} from "@/database/schema";
import { sql, desc, and, eq, type SQL } from "drizzle-orm";

@Injectable()
export class AdminService {
  async getAnalytics() {
    const totalRes = await db.execute(
      sql`SELECT count(*)::int as total FROM ${ingredients};`,
    );
    const total = (totalRes[0] as any)?.total || 1;

    const macroRegionsRes = await db.execute(sql`
      SELECT r_name as label, count(*)::int as count
      FROM (
        SELECT unnest(region) as r_name
        FROM ${ingredients}
      ) sub
      WHERE r_name IN ('North America', 'Global', 'Western Europe', 'Southern Europe', 'East Asia', 'South Asia', 'Mediterranean', 'Central America', 'Southeast Asia', 'Middle East', 'Latin America', 'Caribbean')
      GROUP BY r_name
      ORDER BY count DESC;
    `);

    const southAsianSubregionsRes = await db.execute(sql`
      SELECT r_name as label, count(*)::int as count
      FROM (
        SELECT unnest(region) as r_name
        FROM ${ingredients}
        WHERE 'South Asia' = ANY(region) OR 'India' = ANY(country)
      ) sub
      WHERE r_name NOT IN ('South Asia', 'India', 'South Asian')
      GROUP BY r_name
      ORDER BY count DESC
      LIMIT 15;
    `);

    const cuisinesRes = await db.execute(sql`
      SELECT c_name as label, count(*)::int as count
      FROM (
        SELECT unnest(cuisine) as c_name
        FROM ${ingredients}
      ) sub
      GROUP BY c_name
      ORDER BY count DESC
      LIMIT 15;
    `);

    const flavorsRes = await db.execute(sql`
      SELECT f_name as label, count(*)::int as count
      FROM (
        SELECT unnest(flavor_profile) as f_name
        FROM ${ingredients}
      ) sub
      GROUP BY f_name
      ORDER BY count DESC
      LIMIT 15;
    `);

    const dietaryRes = await db.execute(sql`
      SELECT d_name as label, count(*)::int as count
      FROM (
        SELECT unnest(dietary_flags) as d_name
        FROM ${ingredients}
      ) sub
      GROUP BY d_name
      ORDER BY count DESC;
    `);

    return {
      success: true,
      totalIngredients: total,
      macroRegions: macroRegionsRes,
      southAsianSubregions: southAsianSubregionsRes,
      topCuisines: cuisinesRes,
      flavorProfiles: flavorsRes,
      dietaryFlags: dietaryRes,
    };
  }

  async getQuality() {
    const totalRes = await db.execute(
      sql`SELECT count(*)::int as total FROM ${ingredients};`,
    );
    const total = (totalRes[0] as any)?.total || 1;

    const statsRes = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE image->>'missing' = 'true' OR image IS NULL)::int AS missing_image,
        COUNT(*) FILTER (WHERE fdc_id IS NULL)::int AS missing_fdc,
        COUNT(*) FILTER (WHERE comment IS NULL OR comment = '')::int AS missing_comment,
        COUNT(*) FILTER (WHERE varieties IS NULL OR cardinality(varieties) = 0)::int AS missing_varieties,
        COUNT(*) FILTER (WHERE aliases IS NULL OR cardinality(aliases) = 0)::int AS missing_aliases
      FROM ${ingredients};
    `);
    const stats: any = statsRes[0] || {};

    const orphanRes = await db.execute(sql`
      WITH mapped AS (
        SELECT DISTINCT unnest(matched_ingredients) AS id FROM ${mappings}
      )
      SELECT i.id, i.name, i.created_at
      FROM ${ingredients} i
      WHERE i.id NOT IN (SELECT id FROM mapped WHERE id IS NOT NULL)
      LIMIT 50;
    `);

    const orphanCountRes = await db.execute(sql`
      WITH mapped AS (
        SELECT DISTINCT unnest(matched_ingredients) AS id FROM ${mappings}
      )
      SELECT COUNT(*)::int AS count
      FROM ${ingredients} i
      WHERE i.id NOT IN (SELECT id FROM mapped WHERE id IS NOT NULL);
    `);
    const orphanCount = (orphanCountRes[0] as any)?.count || 0;

    const duplicatesRes = await db.execute(sql`
      SELECT LOWER(name) as clean_name, count(*)::int as count, array_agg(id) as ids
      FROM ${ingredients}
      GROUP BY LOWER(name)
      HAVING count(*) > 1;
    `);
    const potentialDuplicates = duplicatesRes;

    const missingImage = Number(stats.missing_image || 0);
    const missingFdc = Number(stats.missing_fdc || 0);
    const missingComment = Number(stats.missing_comment || 0);
    const missingVarieties = Number(stats.missing_varieties || 0);
    const missingAliases = Number(stats.missing_aliases || 0);

    const healthScore = total > 0
      ? Math.max(0, Math.min(100, Math.round(((total - missingImage) / total) * 100)))
      : 100;

    const metrics = {
      missingImageCount: missingImage,
      missingFdcCount: missingFdc,
      missingCommentCount: missingComment,
      missingVarietiesCount: missingVarieties,
      missingAliasesCount: missingAliases,
      orphanCount,
      potentialDuplicatesCount: duplicatesRes.length,
    };

    return {
      total,
      totalIngredients: total,
      healthScore,
      metrics,
      missingImage,
      missingFdc,
      missingComment,
      missingVarieties,
      missingAliases,
      orphanIngredients: orphanRes,
      orphanCount,
      potentialDuplicates,
    };
  }

  async getAuditLogs(options: {
    type?: string;
    tag?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const { type, tag, status, page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    const filters: SQL[] = [];
    if (type) filters.push(eq(auditLogs.type, type));
    if (tag) filters.push(eq(auditLogs.tag, tag));
    if (status) filters.push(eq(auditLogs.status, status as any));

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const [logs, totalResult] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(whereClause),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  async getDatabaseStats() {
    const [
      totalIngRes,
      totalProdRes,
      totalMappedProdRes,
      byCountryRows,
      byCuisineRows,
      byRegionRows,
      byFlavorRows,
      topIngredientsRows,
      sourceRows,
      ingredientGrowth,
      productGrowth,
      mappingGrowth,
      missingCountryRes,
      missingCuisineRes,
      missingRegionRes,
      missingFlavorRes,
      totalUsdaRes,
      totalMappedNutRes,
    ] = await Promise.all([
      db.execute(sql`SELECT count(*)::int AS count FROM ${ingredients}`),
      db.execute(sql`SELECT count(*)::int AS count FROM ${products}`),
      db.execute(sql`SELECT count(distinct ${mappings.productId})::int AS count FROM ${mappings}`),
      db.execute(sql`
        SELECT elem AS value, count(*)::int AS count
        FROM ${ingredients}, unnest(${ingredients.country}) AS elem
        GROUP BY elem
        ORDER BY count DESC
      `),
      db.execute(sql`
        SELECT elem AS value, count(*)::int AS count
        FROM ${ingredients}, unnest(${ingredients.cuisine}) AS elem
        GROUP BY elem
        ORDER BY count DESC
      `),
      db.execute(sql`
        SELECT elem AS value, count(*)::int AS count
        FROM ${ingredients}, unnest(${ingredients.region}) AS elem
        GROUP BY elem
        ORDER BY count DESC
      `),
      db.execute(sql`
        SELECT elem AS value, count(*)::int AS count
        FROM ${ingredients}, unnest(${ingredients.flavorProfile}) AS elem
        GROUP BY elem
        ORDER BY count DESC
      `),
      db.execute(sql`
        SELECT ${ingredients.name} AS name, counts.count AS count
        FROM (
          SELECT elem AS ingredient_id, count(*)::int AS count
          FROM ${mappings}, unnest(${mappings.matchedIngredients}) AS elem
          GROUP BY elem
          ORDER BY count DESC
          LIMIT 10
        ) AS counts
        JOIN ${ingredients} ON ${ingredients.id} = counts.ingredient_id
        ORDER BY counts.count DESC
      `),
      db.execute(sql`
        SELECT ps.name AS name, count(*)::int AS count
        FROM ${products} AS p
        JOIN ${priceSources} AS ps ON ps.id = p.source_id
        GROUP BY ps.name
        ORDER BY count DESC
      `),
      db.execute(sql`
        WITH monthly AS (
          SELECT date_trunc('month', ${ingredients.createdAt}) AS month, count(*)::int AS monthly_count
          FROM ${ingredients}
          GROUP BY 1
        )
        SELECT to_char(month, 'YYYY-MM') AS date, sum(monthly_count) OVER (ORDER BY month)::int AS count
        FROM monthly ORDER BY month
      `),
      db.execute(sql`
        WITH monthly AS (
          SELECT date_trunc('month', ${products.createdAt}) AS month, count(*)::int AS monthly_count
          FROM ${products}
          GROUP BY 1
        )
        SELECT to_char(month, 'YYYY-MM') AS date, sum(monthly_count) OVER (ORDER BY month)::int AS count
        FROM monthly ORDER BY month
      `),
      db.execute(sql`
        WITH monthly AS (
          SELECT date_trunc('month', ${mappings.createdAt}) AS month, count(*)::int AS monthly_count
          FROM ${mappings}
          GROUP BY 1
        )
        SELECT to_char(month, 'YYYY-MM') AS date, sum(monthly_count) OVER (ORDER BY month)::int AS count
        FROM monthly ORDER BY month
      `),
      db.execute(sql`SELECT count(*)::int AS count FROM ${ingredients} WHERE coalesce(cardinality(${ingredients.country}), 0) = 0`),
      db.execute(sql`SELECT count(*)::int AS count FROM ${ingredients} WHERE coalesce(cardinality(${ingredients.cuisine}), 0) = 0`),
      db.execute(sql`SELECT count(*)::int AS count FROM ${ingredients} WHERE coalesce(cardinality(${ingredients.region}), 0) = 0`),
      db.execute(sql`SELECT count(*)::int AS count FROM ${ingredients} WHERE coalesce(cardinality(${ingredients.flavorProfile}), 0) = 0`),
      db.execute(sql`SELECT count(*)::int AS count FROM ${usdaFoods}`),
      db.execute(sql`SELECT count(*)::int AS count FROM ${ingredients} WHERE ${ingredients.fdcId} IS NOT NULL`),
    ]);

    const totalIngredients = Number((totalIngRes[0] as any)?.count ?? 0);
    const totalProducts = Number((totalProdRes[0] as any)?.count ?? 0);
    const totalMappedProducts = Number((totalMappedProdRes[0] as any)?.count ?? 0);
    const totalUsdaFoods = Number((totalUsdaRes[0] as any)?.count ?? 0);
    const totalMappedNutrition = Number((totalMappedNutRes[0] as any)?.count ?? 0);

    const mappingCoverage =
      totalProducts > 0 ? (totalMappedProducts / totalProducts) * 100 : 0;
    const nutritionCoverage =
      totalIngredients > 0 ? (totalMappedNutrition / totalIngredients) * 100 : 0;

    return {
      totalIngredients,
      totalProducts,
      totalMappedProducts,
      mappingCoverage,
      totalUsdaFoods,
      totalMappedNutrition,
      nutritionCoverage,
      countries: {
        total: (byCountryRows as any[]).length,
        byCountry: Object.fromEntries(
          (byCountryRows as any[]).map((c) => [c.value, Number(c.count)]),
        ),
      },
      cuisines: {
        total: (byCuisineRows as any[]).length,
        byCuisine: Object.fromEntries(
          (byCuisineRows as any[]).map((c) => [c.value, Number(c.count)]),
        ),
      },
      regions: {
        total: (byRegionRows as any[]).length,
        byRegion: Object.fromEntries(
          (byRegionRows as any[]).map((r) => [r.value, Number(r.count)]),
        ),
      },
      flavorProfiles: {
        total: (byFlavorRows as any[]).length,
        byFlavor: Object.fromEntries(
          (byFlavorRows as any[]).map((f) => [f.value, Number(f.count)]),
        ),
      },
      topIngredients: (topIngredientsRows as any[]).map((i) => ({
        name: i.name,
        count: Number(i.count),
      })),
      productsBySource: Object.fromEntries(
        (sourceRows as any[]).map((s) => [s.name, Number(s.count)]),
      ),
      growth: {
        ingredients: (ingredientGrowth as any[]).map((g) => ({ date: g.date, count: Number(g.count) })),
        products: (productGrowth as any[]).map((g) => ({ date: g.date, count: Number(g.count) })),
        mappings: (mappingGrowth as any[]).map((g) => ({ date: g.date, count: Number(g.count) })),
      },
      dataCompleteness: {
        missingCountry: Number((missingCountryRes[0] as any)?.count ?? 0),
        missingCuisine: Number((missingCuisineRes[0] as any)?.count ?? 0),
        missingRegion: Number((missingRegionRes[0] as any)?.count ?? 0),
        missingFlavor: Number((missingFlavorRes[0] as any)?.count ?? 0),
      },
    };
  }

  async triggerGithubScraper() {
    const activeRun = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.type, "SCRAPE_RUN"), eq(auditLogs.status, "pending")))
      .limit(1);

    if (activeRun.length > 0) {
      throw new Error("Ingest already in progress");
    }

    const [log] = await db
      .insert(auditLogs)
      .values({
        type: "SCRAPE_RUN",
        tag: "MANUAL_SCRAPE",
        initiatedBy: "admin",
        metadata: { platform: "github_actions" },
        status: "pending",
      })
      .returning({ id: auditLogs.id });

    try {
      const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
      const REPO_OWNER = "seyone22";
      const REPO_NAME = "ingredient-database-api";

      if (!GITHUB_TOKEN) {
        throw new Error("Missing GITHUB_TOKEN environment variable.");
      }

      const response = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            event_type: "manual_ingest",
          }),
        },
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(`GitHub API Error: ${errData.message || response.statusText}`);
      }

      return {
        success: true,
        message: "Manual scrape dispatched to GitHub Actions successfully.",
        logId: log.id,
      };
    } catch (err) {
      await db
        .update(auditLogs)
        .set({
          status: "failed",
          error: err.message,
          endTime: new Date(),
        })
        .where(eq(auditLogs.id, log.id));
      throw err;
    }
  }
}
