import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/settings";
import { GoogleAuthError, refreshTokens, type GoogleTokens } from "./api";

const KEY = "google";
/** Refresh a little before expiry rather than waiting for a 401 to tell us. */
const EARLY_REFRESH_MS = 60_000;

type StoredConnection = GoogleTokens & {
  email?: string;
  /** Set when the grant is gone. Tokens are kept only so Settings can say what happened. */
  brokenReason?: string;
};

export type Connection =
  | { status: "none" }
  | { status: "ok"; tokens: GoogleTokens; email?: string }
  | { status: "broken"; reason: string };

async function write(connection: StoredConnection | null): Promise<void> {
  const current = await getSettings();
  const keys = { ...current.encryptedKeys };
  if (connection) keys[KEY] = encrypt(JSON.stringify(connection));
  else delete keys[KEY];
  await getDb().update(settings).set({ encryptedKeys: keys }).where(eq(settings.id, 1));
}

/** Never throws: a connection that cannot be read is a broken connection, not a crash. */
export async function readConnection(): Promise<Connection> {
  const current = await getSettings();
  const blob = current.encryptedKeys[KEY];
  if (!blob) return { status: "none" };

  try {
    const stored = JSON.parse(decrypt(blob)) as StoredConnection;
    if (stored.brokenReason) return { status: "broken", reason: stored.brokenReason };
    if (!stored.accessToken || !stored.refreshToken) {
      return { status: "broken", reason: "The stored Google credentials are incomplete. Reconnect." };
    }
    return { status: "ok", tokens: stored, email: stored.email };
  } catch {
    // A rotated ENCRYPTION_KEY lands here. Say so rather than looking disconnected.
    return { status: "broken", reason: "The stored Google credentials could not be read. Reconnect." };
  }
}

export async function saveConnection(tokens: GoogleTokens, email?: string): Promise<void> {
  await write({ ...tokens, ...(email ? { email } : {}) });
}

export async function markBroken(reason: string): Promise<void> {
  const current = await readConnection();
  const base: GoogleTokens =
    current.status === "ok" ? current.tokens : { accessToken: "", refreshToken: "", expiresAt: 0 };
  await write({ ...base, brokenReason: reason });
  console.error(JSON.stringify({ event: "google_connection_broken", reason }));
}

export async function forgetConnection(): Promise<void> {
  await write(null);
}

/**
 * A usable access token, refreshing first if it is close to expiry. A revoked grant marks the
 * connection broken and returns null: the caller stops rather than retrying.
 */
export async function currentAccessToken(): Promise<string | null> {
  const connection = await readConnection();
  if (connection.status !== "ok") return null;
  if (connection.tokens.expiresAt - EARLY_REFRESH_MS > Date.now()) return connection.tokens.accessToken;

  try {
    const refreshed = await refreshTokens(connection.tokens.refreshToken);
    await saveConnection(refreshed, connection.email);
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await markBroken("Google has revoked this connection. Reconnect to start syncing again.");
      return null;
    }
    // Transient: leave the connection alone and let the next tick try again.
    throw error;
  }
}

/**
 * Runs an API call with a valid token, refreshing once if Google rejects it mid-flight. Returns
 * null when the connection is gone, so callers stop instead of looping.
 */
export async function withAccessToken<T>(run: (accessToken: string) => Promise<T>): Promise<T | null> {
  const token = await currentAccessToken();
  if (!token) return null;

  try {
    return await run(token);
  } catch (error) {
    if (!(error instanceof GoogleAuthError)) throw error;

    const connection = await readConnection();
    if (connection.status !== "ok") return null;
    try {
      const refreshed = await refreshTokens(connection.tokens.refreshToken);
      await saveConnection(refreshed, connection.email);
      return await run(refreshed.accessToken);
    } catch (retryError) {
      if (retryError instanceof GoogleAuthError) {
        await markBroken("Google has revoked this connection. Reconnect to start syncing again.");
        return null;
      }
      throw retryError;
    }
  }
}
