import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getDatabaseStats } from "../src/services/metaService";

async function testStats() {
  try {
    const stats = await getDatabaseStats();
    console.log("SUCCESS! Stats:", stats);
  } catch (err) {
    console.error("ERROR in getDatabaseStats():", err);
  }
}

testStats().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
