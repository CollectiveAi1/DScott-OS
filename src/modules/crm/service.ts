import { and, count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { contacts, deals, orgs, pipelines, timeline } from "@/db/schema";
import { handoffBilling, handoffOnboarding } from "./handoffs";

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

export const CONTACT_TYPES = [
  "Client",
  "Prospect",
  "Partner",
  "Investor",
  "Team",
  "Athlete",
  "Parent",
  "Vendor",
] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export type Contact = typeof contacts.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;

export function contactName(contact: Pick<Contact, "firstName" | "lastName">): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

/**
 * The do-not-contact gate. **Nothing may draft a message to a contact carrying this flag** —
 * not the UI, not an automation, and not the Operator.
 *
 * It lives in the service rather than in a form because the Operator does not use forms. M8
 * calls it before an approval is ever written; M9 reaches it through M8.
 */
export function assertContactable(contact: Pick<Contact, "doNotContact" | "firstName" | "lastName">): Result<true> {
  if (contact.doNotContact) {
    return fail(
      "do_not_contact",
      `${contactName(contact)} is marked do-not-contact. Nothing can be drafted to them until that is cleared.`,
    );
  }
  return { ok: true, data: true };
}

/** An org by name, created if it is new. Orgs are a field on a contact, not a screen. */
async function orgIdFor(db: Db, name: string | null): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const [existing] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.name, trimmed)).limit(1);
  if (existing) return existing.id;

  const [created] = await db.insert(orgs).values({ name: trimmed }).returning({ id: orgs.id });
  return created?.id ?? null;
}

export type ContactInput = {
  firstName: string;
  lastName: string | null;
  orgName: string | null;
  email: string | null;
  phone: string | null;
  types: string[];
  tags: string[];
  doNotContact: boolean;
};

async function runClientHandoff(db: Db, contact: Contact, today: string): Promise<void> {
  if (!contact.types.includes("Client")) return;
  await handoffOnboarding(db, { contactId: contact.id, name: contactName(contact), today });
}

export async function createContact(db: Db, input: ContactInput, today: string): Promise<Result<Contact>> {
  if (!input.firstName.trim()) return fail("no_name", "A contact needs at least a first name.");

  const [row] = await db
    .insert(contacts)
    .values({
      firstName: input.firstName.trim(),
      lastName: input.lastName?.trim() || null,
      orgId: await orgIdFor(db, input.orgName),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      types: input.types,
      tags: input.tags,
      doNotContact: input.doNotContact,
    })
    .returning();
  if (!row) return fail("not_saved", "That contact did not save. Try again.");

  await runClientHandoff(db, row, today);
  return { ok: true, data: row };
}

export async function updateContact(
  db: Db,
  id: string,
  input: ContactInput,
  today: string,
): Promise<Result<Contact>> {
  if (!input.firstName.trim()) return fail("no_name", "A contact needs at least a first name.");
  const [existing] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!existing) return fail("not_found", "That contact is no longer there.");

  const [row] = await db
    .update(contacts)
    .set({
      firstName: input.firstName.trim(),
      lastName: input.lastName?.trim() || null,
      orgId: await orgIdFor(db, input.orgName),
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      types: input.types,
      tags: input.tags,
      doNotContact: input.doNotContact,
    })
    .where(eq(contacts.id, id))
    .returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");

  // Gaining the type is the trigger; the handoff's own key keeps it to once per contact.
  await runClientHandoff(db, row, today);
  return { ok: true, data: row };
}

export async function deleteContact(db: Db, id: string): Promise<Result<{ id: string }>> {
  const [row] = await db.delete(contacts).where(eq(contacts.id, id)).returning({ id: contacts.id });
  if (!row) return fail("not_found", "That contact is no longer there.");
  return { ok: true, data: row };
}

export async function logTimelineEntry(
  db: Db,
  input: { kind: "note" | "call" | "meeting"; body: string; contactId: string | null; dealId: string | null },
): Promise<Result<typeof timeline.$inferSelect>> {
  if (!input.body.trim()) return fail("empty", "Write something first.");
  const [row] = await db
    .insert(timeline)
    .values({ kind: input.kind, body: input.body.trim(), contactId: input.contactId, dealId: input.dealId })
    .returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");
  return { ok: true, data: row };
}

export type DealInput = {
  title: string;
  pipelineId: string;
  contactId: string | null;
  stage: string;
  valueCents: number;
  nextStep: string | null;
  nextStepDue: string | null;
  owner: string;
};

async function pipelineById(db: Db, id: string): Promise<Pipeline | null> {
  const [row] = await db.select().from(pipelines).where(eq(pipelines.id, id)).limit(1);
  return row ?? null;
}

export async function createDeal(db: Db, input: DealInput, today: string): Promise<Result<Deal>> {
  if (!input.title.trim()) return fail("no_title", "A deal needs a title.");
  const pipeline = await pipelineById(db, input.pipelineId);
  if (!pipeline) return fail("no_pipeline", "That pipeline is no longer there.");
  if (!pipeline.stages.includes(input.stage)) return fail("bad_stage", "That stage is not on that pipeline.");

  const [row] = await db
    .insert(deals)
    .values({
      title: input.title.trim(),
      pipelineId: input.pipelineId,
      contactId: input.contactId,
      stage: input.stage,
      valueCents: input.valueCents,
      nextStep: input.nextStep?.trim() || null,
      nextStepDue: input.nextStepDue,
      owner: input.owner.trim() || "Devon",
    })
    .returning();
  if (!row) return fail("not_saved", "That deal did not save. Try again.");

  // A deal created straight into a billing stage hands off just the same.
  if (pipeline.billingStages.includes(row.stage)) {
    await handoffBilling(db, {
      dealId: row.id,
      title: row.title,
      valueCents: row.valueCents,
      stage: row.stage,
      contactId: row.contactId,
      today,
    });
  }
  return { ok: true, data: row };
}

export async function updateDeal(db: Db, id: string, input: DealInput, today: string): Promise<Result<Deal>> {
  const [existing] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!existing) return fail("not_found", "That deal is no longer there.");
  if (!input.title.trim()) return fail("no_title", "A deal needs a title.");

  const pipeline = await pipelineById(db, input.pipelineId);
  if (!pipeline) return fail("no_pipeline", "That pipeline is no longer there.");
  if (!pipeline.stages.includes(input.stage)) return fail("bad_stage", "That stage is not on that pipeline.");

  const [row] = await db
    .update(deals)
    .set({
      title: input.title.trim(),
      pipelineId: input.pipelineId,
      contactId: input.contactId,
      stage: input.stage,
      valueCents: input.valueCents,
      nextStep: input.nextStep?.trim() || null,
      nextStepDue: input.nextStepDue,
      owner: input.owner.trim() || "Devon",
    })
    .where(eq(deals.id, id))
    .returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");

  if (row.stage !== existing.stage) await afterStageMove(db, row, existing.stage, pipeline, today);
  return { ok: true, data: row };
}

/**
 * A stage move leaves a record and may hand work to someone. Both happen here, so a move made
 * from the board and a move made from the deal form behave identically.
 */
async function afterStageMove(db: Db, deal: Deal, fromStage: string, pipeline: Pipeline, today: string): Promise<void> {
  await db.insert(timeline).values({
    kind: "stage_move",
    body: `${fromStage} → ${deal.stage}`,
    dealId: deal.id,
    contactId: deal.contactId,
  });

  if (pipeline.billingStages.includes(deal.stage)) {
    await handoffBilling(db, {
      dealId: deal.id,
      title: deal.title,
      valueCents: deal.valueCents,
      stage: deal.stage,
      contactId: deal.contactId,
      today,
    });
  }
}

export async function moveDeal(db: Db, dealId: string, stage: string, today: string): Promise<Result<Deal>> {
  const [existing] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!existing) return fail("not_found", "That deal is no longer there.");
  if (existing.stage === stage) return { ok: true, data: existing };

  const pipeline = await pipelineById(db, existing.pipelineId);
  if (!pipeline) return fail("no_pipeline", "That pipeline is no longer there.");
  if (!pipeline.stages.includes(stage)) return fail("bad_stage", "That stage is not on this pipeline.");

  const [row] = await db.update(deals).set({ stage }).where(eq(deals.id, dealId)).returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");

  await afterStageMove(db, row, existing.stage, pipeline, today);
  return { ok: true, data: row };
}

export async function deleteDeal(db: Db, id: string): Promise<Result<{ id: string }>> {
  const [row] = await db.delete(deals).where(eq(deals.id, id)).returning({ id: deals.id });
  if (!row) return fail("not_found", "That deal is no longer there.");
  return { ok: true, data: row };
}

/**
 * Stage names and billing stages. Renaming a stage **moves the deals standing in it**, and
 * removing a populated stage is refused — losing a deal to a dropdown edit is not an acceptable
 * way for this to fail.
 */
export async function updatePipelineStages(
  db: Db,
  id: string,
  input: { stages: string[]; billingStages: string[] },
): Promise<Result<Pipeline>> {
  const pipeline = await pipelineById(db, id);
  if (!pipeline) return fail("not_found", "That pipeline is no longer there.");

  const stages = input.stages.map((stage) => stage.trim()).filter(Boolean);
  if (stages.length === 0) return fail("no_stages", "A pipeline needs at least one stage.");
  if (new Set(stages).size !== stages.length) return fail("duplicate_stage", "Two stages cannot have the same name.");

  // Same count means this was a rename: position by position, old name to new.
  const renames = new Map<string, string>();
  if (stages.length === pipeline.stages.length) {
    pipeline.stages.forEach((was, index) => {
      const now = stages[index]!;
      if (was !== now) renames.set(was, now);
    });
  }

  const removed = pipeline.stages.filter((stage) => !stages.includes(stage) && !renames.has(stage));
  for (const stage of removed) {
    const [standing] = await db
      .select({ n: count() })
      .from(deals)
      .where(and(eq(deals.pipelineId, id), eq(deals.stage, stage)));
    const n = standing?.n ?? 0;
    if (n > 0) {
      return fail(
        "stage_in_use",
        `${n} deal${n === 1 ? "" : "s"} still stand${n === 1 ? "s" : ""} in "${stage}". Move ${n === 1 ? "it" : "them"} first.`,
      );
    }
  }

  for (const [was, now] of renames) {
    await db
      .update(deals)
      .set({ stage: now })
      .where(and(eq(deals.pipelineId, id), eq(deals.stage, was)));
  }

  // A rename carries the billing flag with it. The form posts whatever was ticked before the
  // edit, so without this, renaming "Deposit" would quietly stop it raising invoices — the same
  // silent loss as orphaning the deals standing in it.
  const billingStages = input.billingStages
    .map((stage) => renames.get(stage) ?? stage)
    .filter((stage) => stages.includes(stage));
  const [row] = await db.update(pipelines).set({ stages, billingStages }).where(eq(pipelines.id, id)).returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");
  return { ok: true, data: row };
}

/** Deals moved in the last seven days, which is what Command's tile counts. */
export async function stageMovesSince(db: Db, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(timeline)
    .where(and(eq(timeline.kind, "stage_move"), sql`${timeline.createdAt} >= ${since}`));
  return row?.n ?? 0;
}
