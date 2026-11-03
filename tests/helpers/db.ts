import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { Db } from "../../src/db/client";
import * as schema from "../../src/db/schema";

/**
 * A fresh in-memory database with every migration applied. Each test file gets its own, so
 * nothing leaks between them and the single-process PGlite lock on .data/ is never touched.
 */
export async function freshDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite("memory://");
  const db = drizzle(client, { schema });
  await migrate(db as unknown as PgliteDatabase, { migrationsFolder: "./drizzle" });
  return { db: db as unknown as Db, close: () => client.close() };
}
