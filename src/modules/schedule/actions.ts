"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { FormState } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { acknowledgeConflict, createEvent, deleteEvent, updateEvent, type Result } from "./service";
import { eventSchema, firstIssue } from "./form-schema";

const UUID = z.string().uuid("That event is no longer there.");

function toFormState<T>(result: Result<T>, ok: string): FormState {
  return result.ok ? { ok } : { error: result.error.message };
}

export async function createEventAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = eventSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const fromTaskId = UUID.safeParse(form.get("fromTaskId"));
  const { timezone } = await getSettings();
  const result = await createEvent(getDb(), parsed.data, timezone, {
    fromTaskId: fromTaskId.success ? fromTaskId.data : null,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/", "layout");
  redirect(`/schedule?date=${parsed.data.startDate}&event=${result.data.id}`);
}

export async function updateEventAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That event is no longer there." };
  const parsed = eventSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const { timezone } = await getSettings();
  const result = await updateEvent(getDb(), id.data, parsed.data, timezone);
  revalidatePath("/", "layout");
  return toFormState(result, "Saved.");
}

/** Two presses, as everywhere else: the first arms the button, the second sends `confirm`. */
export async function deleteEventAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That event is no longer there." };
  if (form.get("confirm") !== "yes") return { error: "Press delete again to confirm." };

  const result = await deleteEvent(getDb(), id.data);
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/", "layout");
  redirect("/schedule");
}

export async function acknowledgeConflictAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = z.object({ a: UUID, b: UUID }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await acknowledgeConflict(getDb(), parsed.data.a, parsed.data.b);
  revalidatePath("/", "layout");
  return toFormState(result, "Acknowledged.");
}
