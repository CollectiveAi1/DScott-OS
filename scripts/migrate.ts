import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { getHandle } from "../src/db/client";

const handle = getHandle();
const migrationsFolder = "./drizzle";

try {
  if (handle.driver === "postgres") {
    await migratePostgres(handle.db, { migrationsFolder });
  } else {
    await migratePglite(handle.db as unknown as PgliteDatabase, { migrationsFolder });
  }
  console.info(`Migrations applied (${handle.driver}).`);
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
