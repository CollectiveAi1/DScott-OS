import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "os_session";
export const SESSION_DAYS = 30;

export type SessionClaims = { v: number; exp: number };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createToken(sessionVersion: number, secret: string, now = Date.now()): string {
  const claims: SessionClaims = { v: sessionVersion, exp: now + SESSION_DAYS * 24 * 60 * 60 * 1000 };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Returns the claims when the signature is valid and the token has not expired, otherwise null. */
export function readToken(token: string | undefined, secret: string, now = Date.now()): SessionClaims | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionClaims>;
    if (typeof claims.v !== "number" || typeof claims.exp !== "number" || claims.exp <= now) return null;
    return { v: claims.v, exp: claims.exp };
  } catch {
    return null;
  }
}
