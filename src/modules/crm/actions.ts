"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { FormState } from "@/lib/auth/actions";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { checkbox, issueToMessage, optionalDate, optionalId, optionalText } from "@/lib/form-fields";
import { parseMoney } from "./money";
import {
  createContact,
  createDeal,
  deleteContact,
  deleteDeal,
  logTimelineEntry,
  moveDeal,
  updateContact,
  updateDeal,
  updatePipelineStages,
  CONTACT_TYPES,
  type Result,
} from "./service";


const UUID = z.string().uuid("That record is no longer there.");

const LABELS: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  orgName: "organisation",
  email: "email",
  phone: "phone",
  title: "title",
  pipelineId: "pipeline",
  stage: "stage",
  nextStep: "next step",
  nextStepDue: "next step date",
  owner: "owner",
  body: "note",
  kind: "kind",
  contactId: "contact",
  dealId: "deal",
};

function toFormState<T>(result: Result<T>, ok: string): FormState {
  return result.ok ? { ok } : { error: result.error.message };
}

const firstIssue = (error: z.ZodError): FormState => issueToMessage(error, LABELS);

async function today(): Promise<string> {
  const { timezone } = await getSettings();
  return dateInZone(new Date(), timezone);
}

/** Comma-separated in the form, an array in the database. */
function toList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const contactSchema = z.object({
  firstName: z.string().trim().min(1, "A contact needs at least a first name.").max(80),
  lastName: optionalText,
  orgName: optionalText,
  email: optionalText,
  phone: optionalText,
});

type Parsed<T> = { ok: true; input: T } | { ok: false; state: FormState };

function contactFrom(form: FormData): Parsed<Parameters<typeof createContact>[1]> {
  const parsed = contactSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, state: firstIssue(parsed.error) };
  return {
    ok: true,
    input: {
      ...parsed.data,
      types: form.getAll("types").map(String).filter((type) => (CONTACT_TYPES as readonly string[]).includes(type)),
      tags: toList(form.get("tags")),
      doNotContact: checkbox.parse(form.get("doNotContact")),
    },
  };
}

export async function createContactAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = contactFrom(form);
  if (!parsed.ok) return parsed.state;

  const result = await createContact(getDb(), parsed.input, await today());
  if (!result.ok) return { error: result.error.message };
  revalidatePath("/", "layout");
  redirect(`/contacts/${result.data.id}`);
}

export async function updateContactAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That contact is no longer there." };
  const parsed = contactFrom(form);
  if (!parsed.ok) return parsed.state;

  const result = await updateContact(getDb(), id.data, parsed.input, await today());
  revalidatePath("/", "layout");
  return toFormState(result, "Saved.");
}

export async function deleteContactAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That contact is no longer there." };
  if (form.get("confirm") !== "yes") return { error: "Press delete again to confirm." };

  const result = await deleteContact(getDb(), id.data);
  if (!result.ok) return { error: result.error.message };
  revalidatePath("/", "layout");
  redirect("/contacts");
}

export async function logEntryAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = z
    .object({
      kind: z.enum(["note", "call", "meeting"]),
      body: z.string().trim().min(1, "Write something first.").max(5000),
      contactId: optionalId,
      dealId: optionalId,
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await logTimelineEntry(getDb(), parsed.data);
  revalidatePath("/", "layout");
  return toFormState(result, parsed.data.kind === "note" ? "Noted." : "Logged.");
}

const dealSchema = z.object({
  title: z.string().trim().min(1, "A deal needs a title.").max(200),
  pipelineId: UUID,
  contactId: optionalId,
  stage: z.string().min(1, "Pick a stage."),
  nextStep: optionalText,
  nextStepDue: optionalDate,
  owner: z.string().trim().max(80).optional(),
});

function dealFrom(form: FormData): Parsed<Parameters<typeof createDeal>[1]> {
  const parsed = dealSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, state: firstIssue(parsed.error) };

  // Money is read here so "$1,250" never reaches the service as anything but cents.
  const money = parseMoney(String(form.get("value") ?? ""));
  if (!money.ok) return { ok: false, state: { error: money.error } };

  return { ok: true, input: { ...parsed.data, owner: parsed.data.owner || "Devon", valueCents: money.cents } };
}

export async function createDealAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = dealFrom(form);
  if (!parsed.ok) return parsed.state;

  const result = await createDeal(getDb(), parsed.input, await today());
  revalidatePath("/", "layout");
  return toFormState(result, `Added ${parsed.input.title}.`);
}

export async function updateDealAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That deal is no longer there." };
  const parsed = dealFrom(form);
  if (!parsed.ok) return parsed.state;

  const result = await updateDeal(getDb(), id.data, parsed.input, await today());
  revalidatePath("/", "layout");
  return toFormState(result, "Saved.");
}

export async function moveDealAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const parsed = z.object({ dealId: UUID, stage: z.string().min(1) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstIssue(parsed.error);

  const result = await moveDeal(getDb(), parsed.data.dealId, parsed.data.stage, await today());
  revalidatePath("/", "layout");
  return toFormState(result, `Moved to ${parsed.data.stage}.`);
}

export async function deleteDealAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("id"));
  if (!id.success) return { error: "That deal is no longer there." };
  if (form.get("confirm") !== "yes") return { error: "Press delete again to confirm." };

  const result = await deleteDeal(getDb(), id.data);
  revalidatePath("/", "layout");
  return toFormState(result, "Deleted.");
}

export async function updateStagesAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireOwner();
  const id = UUID.safeParse(form.get("pipelineId"));
  if (!id.success) return { error: "That pipeline is no longer there." };

  const stages = String(form.get("stages") ?? "")
    .split("\n")
    .map((stage) => stage.trim())
    .filter(Boolean);
  const billingStages = form.getAll("billingStages").map(String);

  const result = await updatePipelineStages(getDb(), id.data, { stages, billingStages });
  revalidatePath("/", "layout");
  return toFormState(result, "Stages saved.");
}
