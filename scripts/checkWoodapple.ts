import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients } from "../src/utils/schema";
import { ilike } from "drizzle-orm";

async function checkWoodapple() {
  const matches = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
    .where(ilike(ingredients.name, "%wood%apple%"));

  console.log("Wood Apple ingredients in DB:", matches);
}

checkWoodapple();
