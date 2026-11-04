import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, contacts, timeline } from "@/db/schema";
import { assertContactable } from "@/modules/crm/service";
import { transition, type ApprovalEvent, type DeliveryMode } from "./machine";
import { isDraftable, parsePayload, summarise, type ApprovalKind } from "./payloads";
import { providerFor, type DeliveryProvider } from "./providers";

export type Approval = typeof approvals.$inferSelect;
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

/** A row stuck mid-send for longer than this is treated as a dead process, not a slow one. */
export const STUCK_MINUTES = 15;

export type CreateInput = {
  kind: ApprovalKind;
  payload: unknown;
  contactId?: string | null;
  arena?: "collective" | "basketball" | "family" | "misc";
  idempotencyKey: string;
  createdBy?: "devon" | "operator" | "automation";
};

export type Created = { approval: Approval; created: boolean };

/**
 * The only way anything in this OS expresses an outbound action. No module, automation or
 * Operator tool may reach a provider; they draft here, and Devon decides.
 *
 * A repeated idempotency key returns the approval that already exists rather than failing: a
 * retried tool call or a double-clicked automation must not produce two drafts of one message.
 */
export async function createApproval(db: Db, input: CreateInput): Promise<Result<Created>> {
  if (!isDraftable(input.kind)) {
    return fail("bad_kind", "That kind of approval is not something this version can draft.");
  }
  if (!input.idempotencyKey.trim()) return fail("no_key", "An approval needs an idempotency key.");

  const parsed = parsePayload(input.kind, input.payload);
  if (!parsed.ok) return fail("bad_payload", parsed.error);

  if (input.contactId) {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, input.contactId)).limit(1);
    if (!contact) return fail("no_contact", "That contact is no longer there.");
    // M6 wrote this guard one milestone early, for exactly this call site.
    const contactable = assertContactable(contact);
    if (!contactable.ok) return fail("do_not_contact", contactable.error.message);
  }

  const [row] = await db
    .insert(approvals)
    .values({
      kind: input.kind,
      payload: parsed.payload as unknown as Record<string, unknown>,
      contactId: input.contactId ?? null,
      arena: input.arena ?? "collective",
      idempotencyKey: input.idempotencyKey.trim(),
      createdBy: input.createdBy ?? "devon",
      status: "waiting",
    })
    .onConflictDoNothing({ target: approvals.idempotencyKey })
    .returning();

  if (row) return { ok: true, data: { approval: row, created: true } };

  const [existing] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.idempotencyKey, input.idempotencyKey.trim()))
    .limit(1);
  if (!existing) return fail("not_saved", "That draft did not save. Try again.");
  return { ok: true, data: { approval: existing, created: false } };
}

async function byId(db: Db, id: string): Promise<Approval | null> {
  const [row] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  return row ?? null;
}

/** A timeline note against the contact, so a decision shows up in their history. */
async function note(db: Db, approval: Approval, body: string): Promise<void> {
  if (!approval.contactId) return;
  await db.insert(timeline).values({
    kind: "note",
    body,
    contactId: approval.contactId,
    createdBy: "automation",
  });
}

/**
 * Apply an event to an approval. Every status change in the codebase comes through here, and
 * every one asks the machine first.
 *
 * The compare-and-set on `status` is what makes a double click safe: the second write matches
 * no row, because the first already moved it.
 */
async function apply(db: Db, id: string, event: ApprovalEvent, now: Date): Promise<Result<Approval>> {
  const current = await byId(db, id);
  if (!current) return fail("not_found", "That approval is no longer there.");

  const decided = transition(current.status, event, now);
  if (!decided.ok) return fail("bad_transition", decided.error);

  const [row] = await db
    .update(approvals)
    .set(decided.next)
    .where(and(eq(approvals.id, id), eq(approvals.status, current.status)))
    .returning();
  if (!row) return fail("already_decided", "That has already been decided.");
  return { ok: true, data: row };
}

export async function approve(
  db: Db,
  id: string,
  mode: DeliveryMode,
  options: { sendAt?: Date; now?: Date } = {},
): Promise<Result<Approval>> {
  const now = options.now ?? new Date();
  const result = await apply(db, id, { type: "approve", mode, sendAt: options.sendAt }, now);
  if (!result.ok) return result;

  // Sandbox ends here. There is no branch from this point to a provider — the row is already
  // "sent", and the delivery job only ever looks at "scheduled" rows.
  if (mode === "sandbox") {
    await note(db, result.data, `Sandbox: would have sent ${summarise(result.data.kind, result.data.payload)}`);
  }
  return result;
}

export async function reject(db: Db, id: string, now = new Date()): Promise<Result<Approval>> {
  const result = await apply(db, id, { type: "reject" }, now);
  if (result.ok) await note(db, result.data, `Rejected: ${summarise(result.data.kind, result.data.payload)}`);
  return result;
}

export async function requeue(db: Db, id: string, now = new Date()): Promise<Result<Approval>> {
  return apply(db, id, { type: "requeue" }, now);
}

/** Editing replaces the payload and keeps the draft waiting. The change is recorded. */
export async function editApproval(db: Db, id: string, payload: unknown, now = new Date()): Promise<Result<Approval>> {
  const current = await byId(db, id);
  if (!current) return fail("not_found", "That approval is no longer there.");

  const allowed = transition(current.status, { type: "edit" }, now);
  if (!allowed.ok) return fail("bad_transition", allowed.error);

  const parsed = parsePayload(current.kind, payload);
  if (!parsed.ok) return fail("bad_payload", parsed.error);

  const before = summarise(current.kind, current.payload);
  const [row] = await db
    .update(approvals)
    .set({ payload: parsed.payload as unknown as Record<string, unknown>, updatedAt: now })
    .where(and(eq(approvals.id, id), eq(approvals.status, "waiting")))
    .returning();
  if (!row) return fail("already_decided", "That has already been decided.");

  await note(db, row, `Draft edited. Was: ${before}`);
  return { ok: true, data: row };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/** A dead process must not strand a row in `sending` forever. */
export async function sweepStuck(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_MINUTES * 60_000);
  const rows = await db
    .update(approvals)
    .set({ status: "failed", failureReason: "interrupted" })
    .where(and(eq(approvals.status, "sending"), lt(approvals.updatedAt, cutoff)))
    .returning({ id: approvals.id });
  return rows.length;
}

/**
 * Take every row that is due. One atomic `UPDATE … RETURNING`, so the database decides who gets
 * a row: two overlapping ticks cannot both claim the same one.
 */
export async function claimDue(db: Db, now = new Date(), limit = 50): Promise<Approval[]> {
  return db
    .update(approvals)
    .set({ status: "sending", updatedAt: now })
    .where(
      and(
        eq(approvals.status, "scheduled"),
        sql`${approvals.sendAt} is not null and ${approvals.sendAt} <= ${now}`,
        sql`${approvals.id} in (select id from ${approvals} where status = 'scheduled' and send_at is not null and send_at <= ${now} limit ${limit})`,
      ),
    )
    .returning();
}

export type DeliverySummary = { claimed: number; sent: number; failed: number; swept: number; reasons: string[] };

/**
 * Deliver what is due. Providers are looked up per kind; in v1 every one of them refuses, which
 * is the point.
 */
export async function deliverDue(
  db: Db,
  options: { now?: Date; provider?: (kind: "email" | "text" | "calendar_write") => DeliveryProvider } = {},
): Promise<DeliverySummary> {
  const now = options.now ?? new Date();
  const lookup = options.provider ?? providerFor;

  const swept = await sweepStuck(db, now);
  const claimed = await claimDue(db, now);

  let sent = 0;
  let failed = 0;
  const reasons: string[] = [];

  for (const row of claimed) {
    if (!isDraftable(row.kind)) {
      await apply(db, row.id, { type: "failed", reason: "Nothing can deliver that kind." }, now);
      failed++;
      continue;
    }

    let outcome: Awaited<ReturnType<DeliveryProvider["deliver"]>>;
    try {
      outcome = await lookup(row.kind).deliver({ payload: row.payload, idempotencyKey: row.idempotencyKey });
    } catch (error) {
      outcome = { ok: false, reason: error instanceof Error ? error.message : "Delivery failed." };
    }

    if (outcome.ok) {
      await apply(db, row.id, { type: "delivered" }, now);
      await note(db, row, `Sent: ${summarise(row.kind, row.payload)}`);
      sent++;
    } else {
      await apply(db, row.id, { type: "failed", reason: outcome.reason }, now);
      failed++;
      if (!reasons.includes(outcome.reason)) reasons.push(outcome.reason);
    }
  }

  return { claimed: claimed.length, sent, failed, swept, reasons };
}
