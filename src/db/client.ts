import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Both drivers expose the same query builder; the app codes against one type.
export type Db = PostgresJsDatabase<typeof schema>;

type Handle = { db: Db; driver: "postgres" | "pglite"; close: () => Promise<void> };

const globalForDb = globalThis as unknown as { __osDb?: Handle };

function connect(): Handle {
  const url = process.env.DATABASE_URL;
  if (url) {
    const sql = postgres(url, {
      max: process.env.VERCEL ? 1 : 5,
      connect_timeout: 10,
      idle_timeout: 20,
      // Supabase's transaction pooler does not support prepared statements.
      prepare: false,
    });
    return { db: drizzlePostgres(sql, { schema }), driver: "postgres", close: () => sql.end() };
  }
  const embeddedAllowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_EMBEDDED_DB === "1";
  if (process.env.VERCEL || !embeddedAllowed) {
    throw new Error("DATABASE_URL is required in production. Set it in the Vercel project settings.");
  }
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (dir !== "memory://") mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return { db, driver: "pglite", close: () => client.close() };
}

export function getHandle(): Handle {
  globalForDb.__osDb ??= connect();
  return globalForDb.__osDb;
}

export function getDb(): Db {
  return getHandle().db;
}
