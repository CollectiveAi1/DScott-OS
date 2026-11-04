"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { FormState } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { issueToMessage, optionalDate, optionalId, optionalText } from "@/lib/form-fields";
import {
  captureTask,
  completeTask,
  createProject,
  deleteTask,
  moveTask,
  reopenTask,
  setProjectStatus,
  triageTask,
  updateTask,
  type Result,
} from "./service";

const ARENA = z.enum(["collective", "basketball", "family", "misc"]);
const PRIORITY = z.enum(["urgent", "high", "normal", "low"]);
const UUID = z.string().uuid("That item is no longer there.");

/** Services speak Result; forms speak FormState. This is the only place the two meet. */
function toFormState<T>(result: Result<T>, ok: string): FormState {
  return result.ok ? { ok } : { error: result.error.message };
}

const WORK_LABELS: Record<string, string> = {
  title: "title",
  notes: "notes",
  due: "due date",
  priority: "priority",
  owner: "owner",
  arena: "arena",
  boardId: "board",
  boardColumn: "column",
  projectId: "project",
  contactId: "contact",
  dealId: "deal",
  name: "name",
};

const firstIssue = (error: z.ZodError): FormState => issueToMessage(error, WORK_LABELS);

async function today(): Promise<string> {
  const { timezone } = await getSettings();
  return dateInZone(new Date(), timezone);
}

/** Both quick-capture inputs land here: Command's and the phone bar's. */
export async function captureAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const line = z.string().max(1000).safeParse(form.get("line") ?? "");
  if (!line.success) return { error: "That capture is too long." };

  const result = await captureTask(getDb(), { line: line.data, today: await today() });
  revalidatePath("/", "layout");
  return toFormState(result, "Captured. It is in your Misc inbox.");
}

const triageSchema = z.object({
  taskId: UUID,
  arena: ARENA,
  boardId: optionalId,
  boardColumn: optionalText,
  due: optionalDate,
  priority: PRIORITY,
});

export async function triageAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = triageSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await triageTask(getDb(), parsed.data);
  revalidatePath("/", "layout");
  return toFormState(result, "Sorted.");
}

export async function moveAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = z.object({ taskId: UUID, column: z.string().min(1) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await moveTask(getDb(), parsed.data.taskId, parsed.data.column);
  revalidatePath("/work");
  return toFormState(result, `Moved to ${parsed.data.column}.`);
}

export async function completeAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = UUID.safeParse(form.get("taskId"));
  if (!parsed.success) return { error: "That task is no longer there." };

  const result = await completeTask(getDb(), parsed.data);
  revalidatePath("/", "layout");
  return toFormState(result, "Done.");
}

export async function reopenAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = UUID.safeParse(form.get("taskId"));
  if (!parsed.success) return { error: "That task is no longer there." };

  const result = await reopenTask(getDb(), parsed.data);
  revalidatePath("/", "layout");
  return toFormState(result, "Reopened.");
}

/**
 * Deleting is two steps: the first click arms the button, the second one sends `confirm`.
 * A dialog would need client state and a focus trap to be accessible; this needs neither.
 */
export async function deleteAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = UUID.safeParse(form.get("taskId"));
  if (!parsed.success) return { error: "That task is no longer there." };
  if (form.get("confirm") !== "yes") return { error: "Press delete again to confirm." };

  const result = await deleteTask(getDb(), parsed.data);
  revalidatePath("/", "layout");
  return toFormState(result, "Deleted.");
}

const editSchema = z.object({
  taskId: UUID,
  title: z.string().trim().min(1, "A task needs a title.").max(200, "Keep the title under 200 characters."),
  notes: optionalText.pipe(z.string().max(5000, "That is a lot of notes.").nullable()),
  due: optionalDate,
  priority: PRIORITY,
  owner: z.string().trim().min(1, "Someone has to own it.").max(80),
  arena: ARENA,
  boardId: optionalId,
  boardColumn: optionalText,
  projectId: optionalId,
  contactId: optionalId,
  dealId: optionalId,
});

export async function updateTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = editSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await updateTask(getDb(), parsed.data);
  revalidatePath("/", "layout");
  return toFormState(result, "Saved.");
}

const projectSchema = z.object({
  name: z.string().trim().min(1, "Give the project a name.").max(120),
  owner: z.string().trim().min(1, "Someone has to own it.").max(80),
  due: optionalDate,
  arena: ARENA,
});

export async function createProjectAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = projectSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await createProject(getDb(), parsed.data);
  revalidatePath("/work/projects");
  return toFormState(result, `Added ${parsed.data.name}.`);
}

export async function setProjectStatusAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = z
    .object({ projectId: UUID, status: z.enum(["active", "paused", "done"]) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await setProjectStatus(getDb(), parsed.data.projectId, parsed.data.status);
  revalidatePath("/work/projects");
  return toFormState(result, `Marked ${parsed.data.status}.`);
}
