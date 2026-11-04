"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import type { FormState } from "./auth/actions";
import { requireOwner } from "./auth/session";
import { getSettings } from "./settings";
import { isSupportedTimeZone, parseProtectedBlock } from "./settings-rules";
import { hasRealProvider, NO_PROVIDER_MESSAGE } from "@/modules/approvals/providers";

export async function setDeliveryModeAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const mode = form.get("mode");
  if (mode !== "sandbox" && mode !== "live") return { error: "Unknown delivery mode." };
  // Going live is the one switch that lets approvals reach real people, so it needs a typed
  // confirmation — and, since M8, a provider that could actually deliver. The typed word guards
  // intent; the provider check guards capability, and both have to pass.
  if (mode === "live") {
    if (form.get("confirm") !== "LIVE") return { error: "Type LIVE to confirm." };
    if (!hasRealProvider()) return { error: NO_PROVIDER_MESSAGE };
  }

  await getSettings();
  await getDb().update(settings).set({ deliveryMode: mode }).where(eq(settings.id, 1));
  revalidatePath("/", "layout");
  return { ok: mode === "live" ? "Live. Approved items will now be delivered." : "Sandbox. Nothing will be delivered." };
}

export async function setTimezoneAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const timezone = form.get("timezone");
  if (!isSupportedTimeZone(timezone)) return { error: "That is not a time zone this server knows." };

  await getSettings();
  await getDb().update(settings).set({ timezone }).where(eq(settings.id, 1));
  // Every "today", due window and protected-time comparison reads this value.
  revalidatePath("/", "layout");
  return { ok: `Time zone set to ${timezone}.` };
}

export async function addProtectedBlockAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const current = await getSettings();
  const result = parseProtectedBlock(
    {
      label: form.get("label"),
      days: form.getAll("days"),
      start: form.get("start"),
      end: form.get("end"),
    },
    current.protectedTime.length,
  );
  if (!result.ok) return { error: result.message };

  await getDb()
    .update(settings)
    .set({ protectedTime: [...current.protectedTime, result.block] })
    .where(eq(settings.id, 1));
  revalidatePath("/settings");
  return { ok: `Protected: ${result.block.label}.` };
}

export async function removeProtectedBlockAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const current = await getSettings();
  const index = Number(form.get("index"));
  const block = Number.isInteger(index) ? current.protectedTime[index] : undefined;
  if (!block) return { error: "That block is no longer there. Reload the page." };

  await getDb()
    .update(settings)
    .set({ protectedTime: current.protectedTime.filter((_, at) => at !== index) })
    .where(eq(settings.id, 1));
  revalidatePath("/settings");
  return { ok: `Removed ${block.label}.` };
}
