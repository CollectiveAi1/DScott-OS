"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { FormState } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { approve, editApproval, reject, requeue } from "./service";

const UUID = z.string().uuid("That approval is no longer there.");

function id(form: FormData): string | null {
  const parsed = UUID.safeParse(form.get("id"));
  return parsed.success ? parsed.data : null;
}

/**
 * Approving reads the delivery mode from settings rather than from the form. The mode is not
 * something a submitted field may assert: in sandbox, this is what keeps "nothing is delivered"
 * true even for a hand-crafted POST.
 */
export async function approveAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const approvalId = id(form);
  if (!approvalId) return { error: "That approval is no longer there." };

  const { deliveryMode } = await getSettings();
  const result = await approve(getDb(), approvalId, deliveryMode);
  revalidatePath("/", "layout");

  if (!result.ok) return { error: result.error.message };
  return {
    ok:
      deliveryMode === "sandbox"
        ? "Approved. Sandbox, so nothing was delivered."
        : "Approved and scheduled for delivery.",
  };
}

export async function rejectAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const approvalId = id(form);
  if (!approvalId) return { error: "That approval is no longer there." };

  const result = await reject(getDb(), approvalId);
  revalidatePath("/", "layout");
  return result.ok ? { ok: "Rejected." } : { error: result.error.message };
}

export async function requeueAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const approvalId = id(form);
  if (!approvalId) return { error: "That approval is no longer there." };

  const result = await requeue(getDb(), approvalId);
  revalidatePath("/", "layout");
  return result.ok ? { ok: "Back in Waiting." } : { error: result.error.message };
}

/**
 * Saving a draft. This is what Enter in a card does — it never approves, which is the one
 * reflex this screen must not allow.
 */
export async function saveAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const approvalId = id(form);
  if (!approvalId) return { error: "That approval is no longer there." };

  const kind = String(form.get("kind") ?? "");
  const payload =
    kind === "email"
      ? { to: form.get("to"), subject: form.get("subject"), body: form.get("body") }
      : kind === "text"
        ? { to: form.get("to"), body: form.get("body") }
        : {
            calendarId: form.get("calendarId"),
            event: {
              title: form.get("title"),
              startsAt: form.get("startsAt"),
              endsAt: form.get("endsAt"),
              location: form.get("location") || undefined,
              notes: form.get("notes") || undefined,
            },
          };

  const result = await editApproval(getDb(), approvalId, payload);
  revalidatePath("/approvals");
  return result.ok ? { ok: "Saved. Not approved." } : { error: result.error.message };
}
