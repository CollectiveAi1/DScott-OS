import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { owner } from "@/db/schema";
import { getAuthSecret } from "./secret";
import { createToken, readToken, SESSION_COOKIE, SESSION_DAYS } from "./token";

export type Owner = { name: string; email: string };

export async function ownerExists(): Promise<boolean> {
  const rows = await getDb().select({ id: owner.id }).from(owner).where(eq(owner.id, 1)).limit(1);
  return rows.length > 0;
}

/** Full check: valid signature, not expired, and issued for the current session version. */
export async function currentOwner(): Promise<Owner | null> {
  const store = await cookies();
  const claims = readToken(store.get(SESSION_COOKIE)?.value, getAuthSecret());
  if (!claims) return null;
  const [row] = await getDb()
    .select({ name: owner.name, email: owner.email, sessionVersion: owner.sessionVersion })
    .from(owner)
    .where(eq(owner.id, 1))
    .limit(1);
  if (!row || row.sessionVersion !== claims.v) return null;
  return { name: row.name, email: row.email };
}

export async function requireOwner(): Promise<Owner> {
  const signedIn = await currentOwner();
  if (signedIn) return signedIn;
  redirect((await ownerExists()) ? "/login" : "/setup");
}

export async function startSession(sessionVersion: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createToken(sessionVersion, getAuthSecret()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
