import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";

export type OsSettings = typeof settings.$inferSelect;

/** The single settings row. Created on first read so a fresh database still renders. */
export async function getSettings(): Promise<OsSettings> {
  const db = getDb();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(settings)
    .values({ id: 1, timezone: process.env.OS_TIMEZONE ?? "America/New_York" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [existing] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!existing) throw new Error("Settings row could not be created.");
  return existing;
}
