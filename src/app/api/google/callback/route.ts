import { NextResponse, type NextRequest } from "next/server";
import { getAuthSecret } from "@/lib/auth/secret";
import { currentOwner } from "@/lib/auth/session";
import { exchangeCode, listCalendars } from "@/modules/google/api";
import { STATE_COOKIE, verifyState } from "@/modules/google/state";
import { saveConnection } from "@/modules/google/tokens";

export const dynamic = "force-dynamic";

function back(outcome: string): NextResponse {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const response = NextResponse.redirect(new URL(`/settings?google=${outcome}`, base));
  response.cookies.delete(STATE_COOKIE);
  return response;
}

/**
 * Finishes consent. The `state` has to match the cookie set when the flow began and still be
 * inside its ten minutes, so a callback URL from anywhere else cannot attach a calendar here.
 */
export async function GET(request: NextRequest) {
  if (!(await currentOwner())) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." } }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("denied");

  const state = params.get("state") ?? undefined;
  const cookie = request.cookies.get(STATE_COOKIE)?.value;
  if (!verifyState(state, cookie, getAuthSecret())) return back("bad_state");

  const code = params.get("code");
  if (!code) return back("no_code");

  try {
    const tokens = await exchangeCode(code);
    // The primary calendar's id is Devon's account address: a label for Settings, nothing more.
    const calendars = await listCalendars(tokens.accessToken).catch(() => []);
    await saveConnection(tokens, calendars.find((calendar) => calendar.primary)?.id);
    return back("connected");
  } catch (error) {
    console.error(JSON.stringify({ event: "google_connect_failed", detail: String(error) }));
    return back("failed");
  }
}
