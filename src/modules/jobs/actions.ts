"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import type { FormState } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { JOBS } from "./registry";
import { runJob } from "./service";

/**
 * Run one job now.
 *
 * The deploy gets one cron a day (Vercel Hobby), so without this a job that is not due — or one
 * that has already used today's window — could not be run again until tomorrow. That is the
 * moment this button is for.
 *
 * It goes through `runJob`, the same path the cron takes, so a manual run is recorded in the
 * history exactly like a scheduled one. **The only thing skipped is the due check**: Devon
 * pressing the button is the schedule.
 */
export async function runJobNowAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();

  const name = String(form.get("job") ?? "");
  const definition = JOBS.find((job) => job.name === name);
  if (!definition) return { error: "There is no job by that name." };

  const { timezone } = await getSettings();
  const run = await runJob(definition, { db: getDb(), timeZone: timezone, now: new Date() });
  revalidatePath("/", "layout");

  if (run.status === "error") return { error: run.detail ?? "It failed, and no reason was recorded." };
  if (run.status === "skipped") return { ok: `Nothing to do: ${run.detail ?? "it had nothing to run."}` };
  return { ok: run.detail ? `Done. ${run.detail}` : "Done." };
}
