"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { FormState } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { optionalText } from "@/lib/form-fields";
import { writeDailyBrief } from "./brief-service";
import { sendMessage } from "./service";

const UUID = z.string().uuid();

/**
 * One message to the Operator.
 *
 * The thread id comes from the form, but nothing else about *what may happen* does: the tools,
 * the prompt and the time zone are all resolved here. A posted field cannot widen what the
 * Operator is allowed to do.
 */
export async function sendAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();

  const text = String(form.get("text") ?? "").trim();
  if (!text) return { error: "Write something first." };

  const requested = optionalText.parse(form.get("thread"));
  const threadId = requested && UUID.safeParse(requested).success ? requested : null;

  const { timezone, protectedTime } = await getSettings();
  const now = new Date();

  const result = await sendMessage(getDb(), {
    threadId,
    text,
    timeZone: timezone,
    today: dateInZone(now, timezone),
    now,
    protectedTime,
  });

  if (!result.ok) {
    revalidatePath("/operator");
    return { error: result.error.message };
  }

  revalidatePath("/", "layout");
  // A new thread becomes the open one, so the answer is on screen rather than one click away.
  if (!threadId) redirect(`/operator?thread=${result.data.threadId}`);
  return { ok: "Answered." };
}

/** Rebuild today's brief by hand, rather than waiting for tomorrow's 06:30 tick. */
export async function regenerateBriefAction(): Promise<void> {
  await requireOwner();
  const { timezone, protectedTime } = await getSettings();
  const now = new Date();
  await writeDailyBrief(getDb(), { day: dateInZone(now, timezone), timeZone: timezone, now, protectedTime });
  revalidatePath("/", "layout");
}
