import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { sql } from "drizzle-orm";

async function inspectRawProduct() {
  const sample = await db.execute(sql`
    SELECT id, name, url, raw
    FROM foodrepo.products
    WHERE name ILIKE '%coopoliva%' OR name ILIKE '%good look%'
    LIMIT 5;
  `);

  for (const row of sample) {
    console.log("NAME:", row.name);
    console.log("URL:", row.url);
    console.log("RAW:", String(row.raw).slice(0, 300));
    console.log("---");
  }
}

inspectRawProduct();
