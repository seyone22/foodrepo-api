import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || "test-admin-key";
const ADMIN_KEY = process.env.ADMIN_API_KEY;

import { Test } from "@nestjs/testing";
import * as assert from "assert";
const request = require("supertest");
import { eq, inArray } from "drizzle-orm";
import { AppModule } from "../src/app.module";
import { ProblemDetailsFilter } from "../src/common/filters/problem-details.filter";
import { db } from "../src/database/database.module";
import { ingredientRedirects, ingredients } from "../src/database/schema";

async function run() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.setGlobalPrefix("api/v1");
  await app.init();

  const httpServer = app.getHttpServer();
  const suffix = Date.now();
  const createdIds: string[] = [];

  try {
    // Seed parent + 5 variety ingredients for concurrency tests
    const [parent] = await db
      .insert(ingredients)
      .values({ name: `__test_parent_${suffix}` })
      .returning();
    createdIds.push(parent.id);

    const varietyRows = await db
      .insert(ingredients)
      .values(
        [1, 2, 3, 4, 5].map((i) => ({
          name: `__test_variety_${suffix}_${i}`,
        })),
      )
      .returning();
    createdIds.push(...varietyRows.map((v) => v.id));

    // 1. Concurrent atomic POST /varieties (5 parallel workers linking to same parent)
    const linkResponses = await Promise.all(
      varietyRows.map((v) =>
        request(httpServer)
          .post(`/api/v1/ingredients/${parent.id}/varieties`)
          .set("x-admin-api-key", ADMIN_KEY)
          .send({ varietyId: v.id }),
      ),
    );
    for (const res of linkResponses) {
      assert.strictEqual(res.status, 200, `Link failed: ${JSON.stringify(res.body)}`);
    }

    const getParentRes = await request(httpServer).get(
      `/api/v1/ingredients/${parent.id}`,
    );
    assert.strictEqual(getParentRes.status, 200);
    assert.ok(getParentRes.headers["etag"], "GET :id should return ETag header");
    assert.strictEqual(
      getParentRes.body.ingredient.varieties.length,
      5,
      "All 5 concurrent variety links must be preserved without lost updates",
    );

    // 2. Optimistic concurrency on PATCH :id
    // 2a. Missing If-Match / expectedUpdatedAt -> 428
    const missingEtagRes = await request(httpServer)
      .patch(`/api/v1/ingredients/${parent.id}`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ comment: "should fail" });
    assert.strictEqual(missingEtagRes.status, 428);

    // 2b. Valid If-Match -> 200, then stale If-Match -> 409 Conflict
    const etag = getParentRes.headers["etag"];
    const [patch1, patch2] = await Promise.all([
      request(httpServer)
        .patch(`/api/v1/ingredients/${parent.id}`)
        .set("x-admin-api-key", ADMIN_KEY)
        .set("If-Match", etag)
        .send({ comment: "worker 1" }),
      request(httpServer)
        .patch(`/api/v1/ingredients/${parent.id}`)
        .set("x-admin-api-key", ADMIN_KEY)
        .set("If-Match", etag)
        .send({ comment: "worker 2" }),
    ]);
    const statuses = [patch1.status, patch2.status].sort();
    assert.deepStrictEqual(
      statuses,
      [200, 409],
      `Expected one 200 and one 409 on concurrent PATCH, got ${statuses}`,
    );

    // 3. Atomic DELETE /varieties/:varietyId
    const unlinkRes = await request(httpServer)
      .delete(`/api/v1/ingredients/${parent.id}/varieties/${varietyRows[0].id}`)
      .set("x-admin-api-key", ADMIN_KEY);
    assert.strictEqual(unlinkRes.status, 200);
    assert.strictEqual(unlinkRes.body.removed, true);
    assert.strictEqual(unlinkRes.body.ingredient.varieties.length, 4);

    // 4. Disjoint POST /ingredients/claim across 4 parallel workers
    const claimResponses = await Promise.all(
      [1, 2, 3, 4].map(() =>
        request(httpServer)
          .post("/api/v1/ingredients/claim?limit=5&claimMinutes=1")
          .set("x-admin-api-key", ADMIN_KEY),
      ),
    );
    const claimedIds = new Set<string>();
    let totalClaimed = 0;
    for (const res of claimResponses) {
      assert.strictEqual(res.status, 200);
      for (const ing of res.body.ingredients) {
        assert.ok(
          !claimedIds.has(ing.id),
          `Duplicate claimed ingredient ${ing.id} across workers!`,
        );
        claimedIds.add(ing.id);
        totalClaimed++;
      }
    }
    assert.ok(totalClaimed > 0, "Expected at least some ingredients claimed");

    // 5. Transactional merge + redirect table
    const mergeRes = await request(httpServer)
      .post("/api/v1/ingredients/merge")
      .set("x-admin-api-key", ADMIN_KEY)
      .send({ sourceId: varietyRows[0].id, targetId: varietyRows[1].id });
    assert.strictEqual(mergeRes.status, 200);

    // PATCH targeting merged sourceId -> 409 with mergedInto
    const stalePatchAfterMerge = await request(httpServer)
      .patch(`/api/v1/ingredients/${varietyRows[0].id}`)
      .set("x-admin-api-key", ADMIN_KEY)
      .send({
        expectedUpdatedAt: varietyRows[0].updatedAt.toISOString(),
        comment: "after merge",
      });
    assert.strictEqual(stalePatchAfterMerge.status, 409);

    // 6. Batch unmapped products + claimMinutes + excludeNonFood
    const [unmapped1, unmapped2] = await Promise.all([
      request(httpServer).get(
        "/api/v1/products/unmapped/random?limit=10&claimMinutes=1&excludeNonFood=true",
      ),
      request(httpServer).get(
        "/api/v1/products/unmapped/random?limit=10&claimMinutes=1&excludeNonFood=true",
      ),
    ]);
    assert.strictEqual(unmapped1.status, 200);
    assert.strictEqual(unmapped2.status, 200);
    assert.ok(unmapped1.body.products.length <= 10);
    const prodIds1 = new Set(unmapped1.body.products.map((p: any) => p.id));
    for (const p of unmapped2.body.products) {
      assert.ok(
        !prodIds1.has(p.id),
        `Duplicate claimed unmapped product ${p.id} across workers!`,
      );
    }

    console.log("ALL CONCURRENCY E2E ASSERTIONS PASSED!");
  } finally {
    // Cleanup test data & release any short claims made during test
    await db
      .delete(ingredientRedirects)
      .where(inArray(ingredientRedirects.sourceId, createdIds));
    await db.delete(ingredients).where(inArray(ingredients.id, createdIds));
    await app.close();
  }
}

run().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});
