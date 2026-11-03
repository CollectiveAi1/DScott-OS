import { NextResponse, type NextRequest } from "next/server";
import { getAuthSecret } from "@/lib/auth/secret";
import { readToken, SESSION_COOKIE } from "@/lib/auth/token";

// /api/cron authenticates itself with CRON_SECRET, so it must be reachable without a session.
const PUBLIC_PATHS = ["/login", "/setup", "/api/health", "/api/cron"];

// Fast gate: rejects requests without a valid signed cookie. The (os) layout then does the
// full check against the database (session version), so a revoked cookie still fails there.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }
  const claims = readToken(request.cookies.get(SESSION_COOKIE)?.value, getAuthSecret());
  if (claims) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." } }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
