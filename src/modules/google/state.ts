import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STATE_COOKIE = "google_oauth_state";
export const STATE_MINUTES = 10;

type StateClaims = { n: string; exp: number };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * The OAuth `state`, signed and short-lived. It is handed to Google and also set as an httpOnly
 * cookie; the callback only accepts a code when the two match and the token has not expired.
 * Without it, a callback URL from anywhere could attach a calendar to this account.
 *
 * Same HMAC shape as the session cookie, and the same secret.
 */
export function createState(secret: string, now = Date.now()): string {
  const claims: StateClaims = { n: randomBytes(12).toString("base64url"), exp: now + STATE_MINUTES * 60_000 };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** True when the value is intact, unexpired, and identical to the one in the cookie. */
export function verifyState(returned: string | undefined, fromCookie: string | undefined, secret: string, now = Date.now()): boolean {
  if (!returned || !fromCookie) return false;

  const given = Buffer.from(returned);
  const stored = Buffer.from(fromCookie);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return false;

  const [body, mac] = returned.split(".");
  if (!body || !mac) return false;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<StateClaims>;
    return typeof claims.exp === "number" && claims.exp > now;
  } catch {
    return false;
  }
}
