import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getSettings } from "@/lib/settings";
import { runDueJobs } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";

function matchesSecret(header: string | null, secret: string): boolean {
  // The Bearer scheme is required, not merely tolerated: Vercel Cron always sends it, so a bare
  // token is a sign of something else calling this route.
  const token = header?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return false;
  const given = Buffer.from(token);
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, so compare lengths first — the length of a
  // secret is not worth protecting, its content is.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The scheduler's only entry point. Vercel Cron calls it with CRON_SECRET as a bearer token;
 * it is in PUBLIC_PATHS because it authenticates itself rather than carrying a session cookie.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(JSON.stringify({ event: "cron_not_configured" }));
    return NextResponse.json(
      { error: { code: "cron_not_configured", message: "CRON_SECRET is not set on this deployment." } },
      { status: 503 },
    );
  }
  if (!matchesSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Valid cron credentials are required." } },
      { status: 401 },
    );
  }

  const { timezone } = await getSettings();
  const result = await runDueJobs({ db: getDb(), timeZone: timezone, now: new Date() });
  return NextResponse.json(result);
}
