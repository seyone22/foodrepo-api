import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { products } from "../src/utils/schema";
import { sql } from "drizzle-orm";

async function checkColumns() {
  const sample = await db.execute(sql`
    SELECT id, name, image, image_url, url, metadata
    FROM foodrepo.products
    WHERE name ILIKE '%coopoliva%' OR name ILIKE '%good look%'
    LIMIT 5;
  `);

  console.log("Sample product row:", sample);
}

checkColumns();
