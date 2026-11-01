"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import type { FormState } from "./auth/actions";
import { currentOwner } from "./auth/session";
import { getSettings } from "./settings";

export async function setDeliveryModeAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!(await currentOwner())) redirect("/login");
  const mode = form.get("mode");
  if (mode !== "sandbox" && mode !== "live") return { error: "Unknown delivery mode." };
  // Going live is the one switch that lets approvals reach real people, so it needs a typed confirmation.
  if (mode === "live" && form.get("confirm") !== "LIVE") return { error: "Type LIVE to confirm." };

  await getSettings();
  await getDb().update(settings).set({ deliveryMode: mode }).where(eq(settings.id, 1));
  revalidatePath("/", "layout");
  return { ok: mode === "live" ? "Live. Approved items will now be delivered." : "Sandbox. Nothing will be delivered." };
}
