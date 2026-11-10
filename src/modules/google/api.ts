import type { GoogleEvent } from "./map-event";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const TIMEOUT_MS = 10_000;

export type GoogleTokens = { accessToken: string; refreshToken: string; expiresAt: number };

/** A refresh that fails this way is final: the grant is gone and retrying only burns requests. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/**
 * The shape Google issues: the project number, a hyphen, a random string, then the domain —
 * `123456789012-abc123def456.apps.googleusercontent.com`.
 *
 * The leading digits are the part that matters. A stand-in written to look plausible usually
 * gets the domain right and the project number wrong, because the domain is the memorable half.
 */
const GOOGLE_CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Set, but not with a credential Google issued.
 *
 * Placeholder values are the quiet failure mode here: `isConfigured()` only asks whether the
 * variables exist, so a stand-in makes Settings say "configured" and then the consent flow dies
 * somewhere on Google's side with a message that explains nothing. Checking the shape turns that
 * into a sentence saying exactly what is wrong — to whoever deploys this, and to the next OS
 * built from it.
 *
 * **This is a warning, never a block.** It is a judgement about a format, and if Google ever
 * issues a different one a real credential would fail this check. So the caller shows the
 * warning and leaves Connect working: being wrong here costs a sentence on screen, not a
 * connection Devon cannot make.
 */
export function hasPlaceholderCredentials(): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return false;
  return !GOOGLE_CLIENT_ID.test(clientId);
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google is not configured on this deployment.");
  return { clientId, clientSecret };
}

export function callbackUrl(): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/google/callback`;
}

export function consentUrl(state: string): string {
  const { clientId } = credentials();
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: SCOPE,
    // offline + consent on every run, so a refresh token always comes back and not only the
    // first time Devon ever authorised this app.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${query.toString()}`;
}

/** One timeout, and one retry for the failures that are worth retrying (§6.1). */
async function request(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const retryable = response.status === 429 || response.status >= 500;
  if (retryable && attempt === 0) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return request(url, init, attempt + 1);
  }
  return response;
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : `http_${response.status}`;
    // invalid_grant means the user revoked access, or a Testing-mode refresh token aged out.
    if (code === "invalid_grant") throw new GoogleAuthError("Google has revoked this connection.");
    throw new Error(`Google refused the request (${code}).`);
  }
  return payload;
}

function tokensFrom(payload: Record<string, unknown>, fallbackRefresh?: string): GoogleTokens {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : (fallbackRefresh ?? "");
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  if (!accessToken) throw new Error("Google did not return an access token.");
  return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000 };
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = credentials();
  const payload = await postForm(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl(),
    grant_type: "authorization_code",
  });
  const tokens = tokensFrom(payload);
  if (!tokens.refreshToken) {
    throw new Error("Google did not return a refresh token. Remove this app at myaccount.google.com and reconnect.");
  }
  return tokens;
}

export async function refreshTokens(refreshToken: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = credentials();
  const payload = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  // A refresh response usually omits refresh_token; the existing one stays valid.
  return tokensFrom(payload, refreshToken);
}

/** Best effort: a revoke that fails must not stop Devon from disconnecting locally. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await request(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "google_revoke_failed", detail: String(error) }));
  }
}

async function getJson(path: string, accessToken: string, query: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const url = `${CALENDAR_API}${path}?${new URLSearchParams(query).toString()}`;
  const response = await request(url, { headers: { authorization: `Bearer ${accessToken}` } });

  if (response.status === 401) throw new GoogleAuthError("Google rejected the access token.");
  if (!response.ok) {
    throw new Error(`Google Calendar returned ${response.status}.`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export type GoogleCalendar = { id: string; summary: string; primary: boolean };

export async function listCalendars(accessToken: string): Promise<GoogleCalendar[]> {
  const payload = await getJson("/users/me/calendarList", accessToken, { maxResults: "250", minAccessRole: "reader" });
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item.id === "string")
    .map((item) => ({
      id: item.id as string,
      summary: typeof item.summary === "string" ? item.summary : (item.id as string),
      primary: item.primary === true,
    }));
}

export async function listEvents(
  accessToken: string,
  input: { calendarId: string; timeMin: string; timeMax: string; pageToken?: string },
): Promise<{ items: GoogleEvent[]; nextPageToken?: string }> {
  const payload = await getJson(`/calendars/${encodeURIComponent(input.calendarId)}/events`, accessToken, {
    // Expanded instances, so a recurring event arrives as individual events with their own ids.
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    ...(input.pageToken ? { pageToken: input.pageToken } : {}),
  });
  return {
    items: (Array.isArray(payload.items) ? payload.items : []) as GoogleEvent[],
    nextPageToken: typeof payload.nextPageToken === "string" ? payload.nextPageToken : undefined,
  };
}
