import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../src/utils/db";
import { ingredients } from "../src/utils/schema";
import { sql } from "drizzle-orm";

async function inspectIndian() {
  const items = await db.execute(sql`
    SELECT id, name, aliases, country, cuisine, region, flavor_profile
    FROM ${ingredients}
    WHERE 'Indian' = ANY(cuisine)
       OR 'South Asian' = ANY(cuisine)
       OR 'India' = ANY(country)
    LIMIT 20;
  `);

  console.log(`Found Indian/South Asian items. Sample:`);
  console.table(items);
}

inspectIndian().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
