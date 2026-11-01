import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

// Readiness: the app is up only if the database answers within 3 seconds.
export async function GET() {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000));
  try {
    await Promise.race([getDb().execute(sql`select 1`), timeout]);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("health check failed", error);
    return NextResponse.json(
      { error: { code: "db_unavailable", message: "Database did not respond." } },
      { status: 503 },
    );
  }
}
