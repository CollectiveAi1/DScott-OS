"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { FormState } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { issueToMessage, optionalDate, optionalText } from "@/lib/form-fields";
import { getSettings } from "@/lib/settings";
import {
  createItem,
  createSkill,
  deleteItem,
  deletePractice,
  deleteSkill,
  ITEM_KINDS,
  ITEM_STATUSES,
  logPractice,
  updateItem,
  updateSkill,
  writeLearningReview,
  type Result,
} from "./service";

const UUID = z.string().uuid("That record is no longer there.");

const LABELS: Record<string, string> = {
  name: "name",
  currentLevel: "current level",
  targetLevel: "target level",
  why: "why",
  title: "title",
  kind: "kind",
  status: "status",
  due: "due date",
  url: "link",
  minutes: "minutes",
  day: "date",
  note: "note",
  skillId: "skill",
};

const firstIssue = (error: z.ZodError): FormState => issueToMessage(error, LABELS);

function toFormState<T>(result: Result<T>, ok: string): FormState {
  return result.ok ? { ok } : { error: result.error.message };
}

async function today(): Promise<string> {
  const { timezone } = await getSettings();
  return dateInZone(new Date(), timezone);
}

const LEVEL = z.coerce.number().int().min(1, "Levels run 1 to 5.").max(5, "Levels run 1 to 5.");

const skillSchema = z.object({
  name: z.string().trim().min(1, "Give the skill a name.").max(80),
  currentLevel: LEVEL,
  targetLevel: LEVEL,
  why: optionalText,
});

export async function createSkillAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = skillSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await createSkill(getDb(), parsed.data);
  if (!result.ok) return { error: result.error.message };
  revalidatePath("/learning");
  redirect(`/learning/${result.data.id}`);
}

export async function updateSkillAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That skill is no longer there." };
  const parsed = skillSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await updateSkill(getDb(), id.data, parsed.data);
  revalidatePath("/learning");
  return toFormState(result, "Saved.");
}

export async function deleteSkillAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That skill is no longer there." };
  if (form.get("confirm") !== "yes") return { error: "Press delete again to confirm. Its practice log goes too." };

  const result = await deleteSkill(getDb(), id.data);
  if (!result.ok) return { error: result.error.message };
  revalidatePath("/learning");
  redirect("/learning");
}

const itemSchema = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(200),
  kind: z.enum(ITEM_KINDS),
  status: z.enum(ITEM_STATUSES),
  due: optionalDate,
  url: optionalText,
});

export async function createItemAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const skillId = UUID.safeParse(form.get("skillId"));
  if (!skillId.success) return { error: "That skill is no longer there." };
  const parsed = itemSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await createItem(getDb(), { ...parsed.data, skillId: skillId.data });
  revalidatePath("/learning");
  return toFormState(result, `Added ${parsed.data.title}.`);
}

export async function updateItemAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That item is no longer there." };
  const parsed = itemSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await updateItem(getDb(), id.data, parsed.data);
  revalidatePath("/learning");
  return toFormState(result, "Saved.");
}

export async function deleteItemAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That item is no longer there." };

  const result = await deleteItem(getDb(), id.data);
  revalidatePath("/learning");
  return toFormState(result, "Removed.");
}

/** Quick-log and the fuller form both land here. */
export async function logPracticeAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = z
    .object({
      skillId: UUID,
      minutes: z.coerce.number().int().min(1, "Log at least one minute.").max(1440, "That is more than a day."),
      day: optionalDate,
      note: optionalText,
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await logPractice(getDb(), {
    skillId: parsed.data.skillId,
    day: parsed.data.day ?? (await today()),
    minutes: parsed.data.minutes,
    note: parsed.data.note,
  });
  revalidatePath("/learning");
  return toFormState(result, `Logged ${parsed.data.minutes} minutes.`);
}

export async function deletePracticeAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That entry is no longer there." };

  const result = await deletePractice(getDb(), id.data);
  revalidatePath("/learning");
  return toFormState(result, "Removed.");
}

/**
 * The review on demand. The job runs once a week; a feature nobody can see until Sunday is a
 * feature nobody trusts.
 */
export async function writeReviewAction(_prev: FormState): Promise<FormState> {
  await requireOwner();
  const result = await writeLearningReview(getDb(), await today());
  revalidatePath("/", "layout");
  if (!result.ok) return { error: result.error.message };
  return { ok: result.data.source === "model" ? "Written." : "Written, using the offline template." };
}
