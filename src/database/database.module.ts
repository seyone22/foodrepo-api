import { Global, Module } from "@nestjs/common";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
const postgres = require("postgres");
import * as schema from "./schema";

export const DRIZZLE = Symbol("DRIZZLE_CONNECTION");
export type DrizzleDb = PostgresJsDatabase<typeof schema>;

let _db: DrizzleDb | undefined;

export function getDb(): DrizzleDb {
  if (_db) return _db;

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

  _db = drizzle(client, { schema });
  return _db;
}

export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_, prop) {
    return (getDb() as any)[prop];
  },
});

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: () => {
        return getDb();
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
