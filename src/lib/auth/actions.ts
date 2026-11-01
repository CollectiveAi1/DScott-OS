"use server";

import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { owner } from "@/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "./password";
import { checkSignInAllowed, clearSignInFailures, recordFailedSignIn } from "./rate-limit";
import { currentOwner, endSession, ownerExists, startSession } from "./session";

export type FormState = { error?: string; ok?: string };

const setupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80),
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(200, "That password is too long."),
});

export async function createOwnerAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (await ownerExists()) redirect("/login");
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const passwordHash = await hashPassword(parsed.data.password);
  // id is fixed at 1, so a second concurrent setup cannot create a second owner.
  const inserted = await getDb()
    .insert(owner)
    .values({ id: 1, name: parsed.data.name, email: parsed.data.email, passwordHash })
    .onConflictDoNothing()
    .returning({ sessionVersion: owner.sessionVersion });
  const created = inserted[0];
  if (!created) redirect("/login");

  await startSession(created.sessionVersion);
  redirect("/");
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().max(200),
});

async function clientKey(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const key = await clientKey();
  const gate = checkSignInAllowed(key);
  if (!gate.allowed) return { error: `Too many attempts. Try again in ${gate.retryInMinutes} min.` };

  const parsed = signInSchema.safeParse(Object.fromEntries(form));
  const [row] = await getDb().select().from(owner).where(eq(owner.id, 1)).limit(1);
  if (!row) redirect("/setup");

  const valid =
    parsed.success && parsed.data.email === row.email && (await verifyPassword(parsed.data.password, row.passwordHash));
  if (!valid) {
    recordFailedSignIn(key);
    return { error: "That email and password don't match." };
  }

  clearSignInFailures(key);
  await startSession(row.sessionVersion);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

const passwordChangeSchema = z.object({
  current: z.string().max(200),
  next: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(200, "That password is too long."),
});

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await currentOwner())) redirect("/login");
  const parsed = passwordChangeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const [row] = await getDb().select().from(owner).where(eq(owner.id, 1)).limit(1);
  if (!row || !(await verifyPassword(parsed.data.current, row.passwordHash))) {
    return { error: "Current password is wrong." };
  }

  // Bumping the session version signs out every other device.
  const [updated] = await getDb()
    .update(owner)
    .set({ passwordHash: await hashPassword(parsed.data.next), sessionVersion: sql`${owner.sessionVersion} + 1` })
    .where(eq(owner.id, 1))
    .returning({ sessionVersion: owner.sessionVersion });
  if (updated) await startSession(updated.sessionVersion);
  return { ok: "Password changed. Other devices are signed out." };
}
