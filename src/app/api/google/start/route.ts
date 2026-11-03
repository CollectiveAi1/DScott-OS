import { NextResponse } from "next/server";
import { currentOwner } from "@/lib/auth/session";
import { getAuthSecret } from "@/lib/auth/secret";
import { consentUrl, isConfigured } from "@/modules/google/api";
import { createState, STATE_COOKIE, STATE_MINUTES } from "@/modules/google/state";

export const dynamic = "force-dynamic";

/** Begins consent. Only a signed-in Devon can attach a calendar to his own OS. */
export async function GET() {
  if (!(await currentOwner())) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." } }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.redirect(new URL("/settings?google=not_configured", process.env.APP_URL ?? "http://localhost:3000"));
  }

  const state = createState(getAuthSecret());
  const response = NextResponse.redirect(consentUrl(state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MINUTES * 60,
  });
  return response;
}
