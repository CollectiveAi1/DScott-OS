import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { currentOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import * as schema from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Fields that must never leave the instance, by column name. The password hash is useless to
 * Devon and dangerous in a downloads folder; the encrypted keys are OAuth tokens.
 */
const WITHHELD = new Set(["passwordHash", "encryptedKeys"]);

function withoutSecrets(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !WITHHELD.has(key)));
}

/** Every exported table, by the name Devon will see in the file. */
function exportableTables() {
  return Object.entries(schema).filter(
    (entry): entry is [string, typeof schema.tasks] =>
      typeof entry[1] === "object" && entry[1] !== null && Symbol.for("drizzle:IsDrizzleTable") in entry[1],
  );
}

/** "Export my data": one JSON file holding every row, minus the two withheld fields. */
export async function GET() {
  // Middleware has already checked the cookie signature; this re-checks the session version.
  if (!(await currentOwner())) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." } }, { status: 401 });
  }

  const db = getDb();
  const { timezone } = await getSettings();
  const tables: Record<string, Record<string, unknown>[]> = {};

  for (const [name, table] of exportableTables()) {
    const rows = (await db.select().from(table)) as Record<string, unknown>[];
    tables[name] = rows.map(withoutSecrets);
  }

  const body = JSON.stringify({ exportedAt: new Date().toISOString(), timezone, tables }, null, 2);
  const filename = `dscott-os-export-${dateInZone(new Date(), timezone)}.json`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
