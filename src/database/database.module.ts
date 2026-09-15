import { Global, Module } from "@nestjs/common";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
const postgres = require("postgres");
import * as schema from "./schema";

export const DRIZZLE = Symbol("DRIZZLE_CONNECTION");
export type DrizzleDb = PostgresJsDatabase<typeof schema>;

export let db: DrizzleDb;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error("DATABASE_URL environment variable is required");
        }
        const client = postgres(connectionString, {
          max: 5,
          prepare: false,
          ssl: "require",
          idle_timeout: 5,
          connect_timeout: 10,
        });
        db = drizzle(client, { schema });
        return db;
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
