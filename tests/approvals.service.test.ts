import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db/client";
import { approvals, contacts, timeline } from "../src/db/schema";
import {
  approve,
  claimDue,
  createApproval,
  deliverDue,
  editApproval,
  reject,
  requeue,
  sweepStuck,
  STUCK_MINUTES,
  type CreateInput,
} from "../src/modules/approvals/service";
import type { DeliveryProvider } from "../src/modules/approvals/providers";
import { freshDb } from "./helpers/db";

const NOW = new Date("2026-11-04T15:00:00Z");
const EMAIL = { to: "rosa@example.com", subject: "The pilot", body: "Here is the quote." };

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.delete(timeline);
  await db.delete(approvals);
  await db.delete(contacts);
});

let keyCounter = 0;
function input(overrides: Partial<CreateInput> = {}): CreateInput {
  return {
    kind: "email",
    payload: EMAIL,
    arena: "collective",
    idempotencyKey: `key-${++keyCounter}`,
    ...overrides,
  };
}

async function draft(overrides: Partial<CreateInput> = {}) {
  const result = await createApproval(db, input(overrides));
  if (!result.ok) throw new Error(result.error.message);
  return result.data.approval;
}

/** A provider that records every call, so "never called" can be asserted rather than hoped. */
function spyProvider(): { provider: () => DeliveryProvider; calls: number } {
  const state = { calls: 0 };
  const provider = (): DeliveryProvider => ({
    kind: "email",
    name: "spy",
    supportsIdempotency: true,
    async deliver() {
      state.calls++;
      return { ok: true };
    },
  });
  return { provider, get calls() { return state.calls; } };
}

describe("createApproval", () => {
  it("drafts a waiting approval, deciding nothing", async () => {
    const approval = await draft();
    expect(approval).toMatchObject({ status: "waiting", kind: "email", arena: "collective", createdBy: "devon" });
    expect(approval.decidedAt).toBeNull();
    expect(approval.mode).toBeNull();
  });

  it("records who drafted it", async () => {
    const approval = await draft({ createdBy: "operator" });
    expect(approval.createdBy).toBe("operator");
  });

  it("returns the existing approval for a repeated idempotency key, creating nothing", async () => {
    const first = await createApproval(db, input({ idempotencyKey: "same" }));
    const second = await createApproval(db, input({ idempotencyKey: "same", payload: { ...EMAIL, subject: "Different" } }));

    expect(first.ok && first.data.created).toBe(true);
    expect(second.ok && second.data.created).toBe(false);
    expect(second.ok && second.data.approval.id).toBe(first.ok ? first.data.approval.id : null);
    // The first draft stands: a retry is not an edit.
    expect(second.ok && (second.data.approval.payload as { subject: string }).subject).toBe("The pilot");
    expect(await db.select().from(approvals)).toHaveLength(1);
  });

  it("refuses a payload that does not match its kind", async () => {
    expect(await createApproval(db, input({ payload: { to: "", subject: "", body: "" } }))).toMatchObject({
      ok: false,
      error: { code: "bad_payload" },
    });
    expect(await db.select().from(approvals)).toHaveLength(0);
  });

  it("refuses a kind this version cannot draft", async () => {
    expect(await createApproval(db, input({ kind: "other" }))).toMatchObject({ ok: false, error: { code: "bad_kind" } });
  });

  it("refuses a contact marked do-not-contact", async () => {
    const [quiet] = await db
      .insert(contacts)
      .values({ firstName: "Quiet", lastName: "Neighbour", doNotContact: true })
      .returning();

    const result = await createApproval(db, input({ contactId: quiet!.id }));
    expect(result).toMatchObject({ ok: false, error: { code: "do_not_contact" } });
    if (!result.ok) expect(result.error.message).toContain("Quiet Neighbour");
    expect(await db.select().from(approvals)).toHaveLength(0);
  });

  it("allows a contact who is not marked", async () => {
    const [rosa] = await db.insert(contacts).values({ firstName: "Rosa" }).returning();
    expect((await createApproval(db, input({ contactId: rosa!.id }))).ok).toBe(true);
  });
});

describe("approving in sandbox", () => {
  it("moves it to sent, records the mode, and writes a timeline row", async () => {
    // PRD §8.8's first acceptance criterion.
    const [rosa] = await db.insert(contacts).values({ firstName: "Rosa" }).returning();
    const approval = await draft({ contactId: rosa!.id });

    const result = await approve(db, approval.id, "sandbox", { now: NOW });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toMatchObject({ status: "sent", mode: "sandbox", decidedAt: NOW });

    const rows = await db.select().from(timeline).where(eq(timeline.contactId, rosa!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("Sandbox: would have sent The pilot → rosa@example.com");
  });

  it("never calls a provider — asserted with a spy", async () => {
    const spy = spyProvider();
    const approval = await draft();
    await approve(db, approval.id, "sandbox", { now: NOW });

    // And a delivery run afterwards finds nothing of it either: the row is already sent, and
    // the job only ever looks at scheduled rows.
    const summary = await deliverDue(db, { now: NOW, provider: spy.provider });
    expect(spy.calls).toBe(0);
    expect(summary.claimed).toBe(0);
  });

  it("schedules rather than sends when the mode is live", async () => {
    const approval = await draft();
    const result = await approve(db, approval.id, "live", { now: NOW });
    expect(result.ok && result.data).toMatchObject({ status: "scheduled", mode: "live", sendAt: NOW });
  });
});

describe("deciding twice", () => {
  it("makes one transition; the second says it was already decided", async () => {
    const approval = await draft();
    const first = await approve(db, approval.id, "sandbox", { now: NOW });
    const second = await approve(db, approval.id, "sandbox", { now: NOW });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false });
    if (!second.ok) expect(second.error.message).toBe("That has already been decided.");

    const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(row?.status).toBe("sent");
  });

  it("survives two approvals landing at the same moment", async () => {
    const approval = await draft();
    const [a, b] = await Promise.all([
      approve(db, approval.id, "sandbox", { now: NOW }),
      approve(db, approval.id, "sandbox", { now: NOW }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("refuses to reject something already sent", async () => {
    const approval = await draft();
    await approve(db, approval.id, "sandbox", { now: NOW });
    expect(await reject(db, approval.id, NOW)).toMatchObject({ ok: false });
  });
});

describe("rejecting and requeuing", () => {
  it("rejects a waiting draft and notes it", async () => {
    const [rosa] = await db.insert(contacts).values({ firstName: "Rosa" }).returning();
    const approval = await draft({ contactId: rosa!.id });

    expect((await reject(db, approval.id, NOW)).ok).toBe(true);
    const rows = await db.select().from(timeline);
    expect(rows[0]?.body).toContain("Rejected:");
  });

  it("rejects a scheduled one, so an approved message can still be stopped", async () => {
    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });
    const result = await reject(db, approval.id, NOW);
    expect(result.ok && result.data).toMatchObject({ status: "rejected", sendAt: null });
  });

  it("requeues a failed one back to waiting, clearing the reason", async () => {
    const approval = await draft();
    await db.update(approvals).set({ status: "failed", failureReason: "No email provider connected." }).where(eq(approvals.id, approval.id));

    const result = await requeue(db, approval.id, NOW);
    expect(result.ok && result.data).toMatchObject({ status: "waiting", failureReason: null, sendAt: null });
  });
});

describe("editing", () => {
  it("replaces the payload, keeps it waiting, and records what it was", async () => {
    const [rosa] = await db.insert(contacts).values({ firstName: "Rosa" }).returning();
    const approval = await draft({ contactId: rosa!.id });

    const result = await editApproval(db, approval.id, { ...EMAIL, subject: "The pilot, revised" }, NOW);
    expect(result.ok && result.data).toMatchObject({ status: "waiting" });
    expect(result.ok && (result.data.payload as { subject: string }).subject).toBe("The pilot, revised");

    const rows = await db.select().from(timeline);
    expect(rows[0]?.body).toContain("Draft edited. Was: The pilot →");
  });

  it("refuses a bad payload rather than storing it", async () => {
    const approval = await draft();
    expect(await editApproval(db, approval.id, { to: "", subject: "", body: "" }, NOW)).toMatchObject({
      ok: false,
      error: { code: "bad_payload" },
    });
  });

  it("refuses once it has been decided", async () => {
    const approval = await draft();
    await approve(db, approval.id, "sandbox", { now: NOW });
    expect(await editApproval(db, approval.id, EMAIL, NOW)).toMatchObject({ ok: false });
  });
});

describe("claiming and sweeping", () => {
  it("claims only rows that are due", async () => {
    const due = await draft();
    const later = await draft();
    await approve(db, due.id, "live", { now: NOW });
    await approve(db, later.id, "live", { now: NOW, sendAt: new Date("2026-11-05T15:00:00Z") });

    const claimed = await claimDue(db, NOW);
    expect(claimed.map((row) => row.id)).toEqual([due.id]);
    expect(claimed[0]?.status).toBe("sending");
  });

  it("gives a row to only one of two overlapping claims", async () => {
    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });

    const [first, second] = await Promise.all([claimDue(db, NOW), claimDue(db, NOW)]);
    expect(first.length + second.length).toBe(1);
  });

  it("sweeps a row stuck sending back to failed, by name", async () => {
    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });
    await claimDue(db, NOW);

    const later = new Date(NOW.getTime() + (STUCK_MINUTES + 1) * 60_000);
    expect(await sweepStuck(db, later)).toBe(1);

    const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(row).toMatchObject({ status: "failed", failureReason: "interrupted" });
  });

  it("leaves a row that has only just been claimed", async () => {
    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });
    await claimDue(db, NOW);

    const soon = new Date(NOW.getTime() + (STUCK_MINUTES - 1) * 60_000);
    expect(await sweepStuck(db, soon)).toBe(0);
  });
});

describe("delivery in v1", () => {
  it("always fails, with the reason naming the missing provider", async () => {
    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });

    const summary = await deliverDue(db, { now: NOW });
    expect(summary).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(summary.reasons).toEqual(["No email provider connected."]);

    const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(row).toMatchObject({ status: "failed", failureReason: "No email provider connected." });
  });

  it("passes the idempotency key to a provider that wants it", async () => {
    const seen: string[] = [];
    const provider = (): DeliveryProvider => ({
      kind: "email",
      name: "test",
      supportsIdempotency: true,
      async deliver({ idempotencyKey }) {
        seen.push(idempotencyKey);
        return { ok: true };
      },
    });

    const approval = await draft({ idempotencyKey: "the-key" });
    await approve(db, approval.id, "live", { now: NOW });
    await deliverDue(db, { now: NOW, provider });

    expect(seen).toEqual(["the-key"]);
  });

  it("records a provider that throws as a failure, not a crash", async () => {
    const provider = (): DeliveryProvider => ({
      kind: "email",
      name: "broken",
      supportsIdempotency: false,
      async deliver() {
        throw new Error("socket hang up");
      },
    });

    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });
    const summary = await deliverDue(db, { now: NOW, provider });

    expect(summary.failed).toBe(1);
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(row?.failureReason).toBe("socket hang up");
  });

  it("marks a successful delivery as sent and notes it", async () => {
    const [rosa] = await db.insert(contacts).values({ firstName: "Rosa" }).returning();
    const spy = spyProvider();
    const approval = await draft({ contactId: rosa!.id });
    await approve(db, approval.id, "live", { now: NOW });

    const summary = await deliverDue(db, { now: NOW, provider: spy.provider });
    expect(summary).toMatchObject({ sent: 1, failed: 0 });
    expect(spy.calls).toBe(1);

    const [row] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(row).toMatchObject({ status: "sent", mode: "live" });
    expect((await db.select().from(timeline))[0]?.body).toContain("Sent:");
  });

  it("does nothing, loudly or otherwise, when nothing is due", async () => {
    const spy = spyProvider();
    expect(await deliverDue(db, { now: NOW, provider: spy.provider })).toMatchObject({ claimed: 0, sent: 0, failed: 0 });
    expect(spy.calls).toBe(0);
  });
});

describe("the approvals-deliver job", () => {
  it("runs the registered definition without throwing", async () => {
    const { JOBS } = await import("../src/modules/jobs/registry");
    const { runJob } = await import("../src/modules/jobs/service");

    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });

    const definition = JOBS.find((job) => job.name === "approvals-deliver")!;
    const run = await runJob(definition, { db, timeZone: "America/New_York", now: NOW });

    // Everything fails in v1, so the run records an error — and still does not throw.
    expect(["ok", "error"]).toContain(run.status);
    expect(run.detail).toContain("provider");
  });
});

describe("the spy itself", () => {
  it("would notice a call, so 'never called' means something", async () => {
    const spy = spyProvider();
    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });
    await deliverDue(db, { now: NOW, provider: spy.provider });
    expect(spy.calls).toBe(1);
  });
});

describe("the tabs and the Command tile", () => {
  it("count the same waiting approvals", async () => {
    // PRD §8.8's third acceptance criterion.
    const { tabCounts, waitingCount, listApprovals } = await import("../src/modules/approvals/queries");

    const first = await draft();
    const second = await draft();
    const third = await draft();
    await approve(db, first.id, "live", { now: NOW });   // scheduled
    await approve(db, second.id, "sandbox", { now: NOW }); // history

    const counts = await tabCounts(db);
    const waiting = await waitingCount(db);
    const rows = await listApprovals(db, "waiting");

    expect(counts.waiting).toBe(1);
    expect(waiting).toBe(counts.waiting);
    expect(rows).toHaveLength(counts.waiting);
    expect(rows[0]?.id).toBe(third.id);

    expect(counts.scheduled).toBe(1);
    expect(counts.history).toBe(1);
    expect(counts.failed).toBe(0);
  });

  it("puts a claimed row in Scheduled rather than losing it between tabs", async () => {
    const { tabCounts } = await import("../src/modules/approvals/queries");
    const approval = await draft();
    await approve(db, approval.id, "live", { now: NOW });
    await claimDue(db, NOW);

    const counts = await tabCounts(db);
    expect(counts.scheduled).toBe(1);
    expect(counts.waiting + counts.failed + counts.history).toBe(0);
  });
});
