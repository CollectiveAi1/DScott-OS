import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { contacts, deals, orgs, pipelines, tasks, timeline } from "../src/db/schema";
import { BILLING_OWNER, ONBOARDING_OWNER } from "../src/modules/crm/handoffs";
import {
  createContact,
  createDeal,
  moveDeal,
  stageMovesSince,
  updateContact,
  type ContactInput,
  type DealInput,
} from "../src/modules/crm/service";
import { freshDb } from "./helpers/db";

// 2026-11-05 is a Thursday, so +2 business days is Monday the 9th.
const TODAY = "2026-11-05";
const CLIENT_BUILDS = {
  name: "Client builds",
  stages: ["Lead", "Scope call", "Quote sent", "Deposit", "Building", "Delivered", "Lost"],
  billingStages: ["Deposit"],
};

let db: Db;
let close: () => Promise<void>;
let pipelineId: string;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(timeline);
  await db.delete(deals);
  await db.delete(contacts);
  await db.delete(orgs);
  await db.delete(pipelines);
  const [pipeline] = await db.insert(pipelines).values(CLIENT_BUILDS).returning();
  pipelineId = pipeline!.id;
});

function dealInput(overrides: Partial<DealInput> = {}): DealInput {
  return {
    title: "Daycare site build",
    pipelineId,
    contactId: null,
    stage: "Quote sent",
    valueCents: 125000,
    nextStep: "Send the quote",
    nextStepDue: "2026-11-10",
    owner: "Devon",
    ...overrides,
  };
}

function contactInput(overrides: Partial<ContactInput> = {}): ContactInput {
  return {
    firstName: "Rosa",
    lastName: "Delgado",
    orgName: "Bright Start Daycare",
    email: "rosa@example.com",
    phone: "614-555-0142",
    types: ["Prospect"],
    tags: [],
    doNotContact: false,
    ...overrides,
  };
}

async function makeDeal(overrides: Partial<DealInput> = {}) {
  const result = await createDeal(db, dealInput(overrides), TODAY);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const invoiceTasks = () => db.select().from(tasks).where(eq(tasks.owner, BILLING_OWNER));
const onboardTasks = () => db.select().from(tasks).where(eq(tasks.owner, ONBOARDING_OWNER));

describe("billing handoff", () => {
  it("creates exactly one Ahmad task when a deal reaches a billing stage", async () => {
    const deal = await makeDeal();
    expect(await invoiceTasks()).toHaveLength(0);

    await moveDeal(db, deal.id, "Deposit", TODAY);

    const created = await invoiceTasks();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: "Invoice: Daycare site build ($1,250.00)",
      owner: "Ahmad",
      arena: "collective",
      createdBy: "automation",
      dealId: deal.id,
      // Thursday + 2 business days is Monday.
      due: "2026-11-09",
    });
  });

  it("does not create a second when the deal moves out and back", async () => {
    // PRD §8.6's acceptance criterion, exactly.
    const deal = await makeDeal();
    await moveDeal(db, deal.id, "Deposit", TODAY);
    await moveDeal(db, deal.id, "Building", TODAY);
    await moveDeal(db, deal.id, "Deposit", TODAY);

    expect(await invoiceTasks()).toHaveLength(1);
  });

  it("does not create a second if the same move lands twice", async () => {
    const deal = await makeDeal();
    await Promise.all([moveDeal(db, deal.id, "Deposit", TODAY), moveDeal(db, deal.id, "Deposit", TODAY)]);
    expect(await invoiceTasks()).toHaveLength(1);
  });

  it("can be created again after Devon deletes it, and still only once", async () => {
    // The guarantee is no duplicates while the task exists. Deleting it takes its key with it,
    // so a later move can raise a fresh one — useful if the first was deleted by mistake.
    const deal = await makeDeal();
    await moveDeal(db, deal.id, "Deposit", TODAY);
    await db.delete(tasks).where(eq(tasks.owner, BILLING_OWNER));

    await moveDeal(db, deal.id, "Building", TODAY);
    await moveDeal(db, deal.id, "Deposit", TODAY);
    expect(await invoiceTasks()).toHaveLength(1);

    // And the no-duplicates rule still holds from here.
    await moveDeal(db, deal.id, "Building", TODAY);
    await moveDeal(db, deal.id, "Deposit", TODAY);
    expect(await invoiceTasks()).toHaveLength(1);
  });

  it("does not fire for a stage that is not a billing stage", async () => {
    const deal = await makeDeal();
    await moveDeal(db, deal.id, "Building", TODAY);
    await moveDeal(db, deal.id, "Delivered", TODAY);
    expect(await invoiceTasks()).toHaveLength(0);
  });

  it("fires for a deal created straight into a billing stage", async () => {
    await makeDeal({ stage: "Deposit" });
    expect(await invoiceTasks()).toHaveLength(1);
  });

  it("gives each deal its own handoff", async () => {
    const first = await makeDeal({ title: "First build" });
    const second = await makeDeal({ title: "Second build" });
    await moveDeal(db, first.id, "Deposit", TODAY);
    await moveDeal(db, second.id, "Deposit", TODAY);
    expect(await invoiceTasks()).toHaveLength(2);
  });

  it("carries the value as money, from cents", async () => {
    const deal = await makeDeal({ valueCents: 999 });
    await moveDeal(db, deal.id, "Deposit", TODAY);
    expect((await invoiceTasks())[0]?.title).toBe("Invoice: Daycare site build ($9.99)");
  });
});

describe("onboarding handoff", () => {
  it("creates one Kenza task when a contact becomes a Client", async () => {
    const created = await createContact(db, contactInput(), TODAY);
    expect(created.ok).toBe(true);
    expect(await onboardTasks()).toHaveLength(0);

    if (!created.ok) return;
    await updateContact(db, created.data.id, contactInput({ types: ["Prospect", "Client"] }), TODAY);

    const handoff = await onboardTasks();
    expect(handoff).toHaveLength(1);
    expect(handoff[0]).toMatchObject({
      title: "Onboard: Rosa Delgado",
      owner: "Kenza",
      createdBy: "automation",
      contactId: created.data.id,
      due: "2026-11-09",
    });
  });

  it("creates it once however many times the contact is saved", async () => {
    const created = await createContact(db, contactInput({ types: ["Client"] }), TODAY);
    if (!created.ok) throw new Error("contact did not save");

    await updateContact(db, created.data.id, contactInput({ types: ["Client"] }), TODAY);
    await updateContact(db, created.data.id, contactInput({ types: ["Client", "Partner"] }), TODAY);
    await updateContact(db, created.data.id, contactInput({ types: ["Prospect"] }), TODAY);
    await updateContact(db, created.data.id, contactInput({ types: ["Client"] }), TODAY);

    expect(await onboardTasks()).toHaveLength(1);
  });

  it("does not fire for a contact who is not a Client", async () => {
    await createContact(db, contactInput({ types: ["Prospect", "Partner"] }), TODAY);
    expect(await onboardTasks()).toHaveLength(0);
  });

  it("gives each contact their own", async () => {
    await createContact(db, contactInput({ firstName: "Rosa", types: ["Client"] }), TODAY);
    await createContact(db, contactInput({ firstName: "Marcus", types: ["Client"] }), TODAY);
    expect(await onboardTasks()).toHaveLength(2);
  });
});

describe("stage moves", () => {
  it("writes a timeline row naming both stages", async () => {
    const deal = await makeDeal();
    await moveDeal(db, deal.id, "Deposit", TODAY);

    const rows = await db.select().from(timeline).where(eq(timeline.dealId, deal.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "stage_move", body: "Quote sent → Deposit" });
  });

  it("files the move against the contact as well, so it shows in their history", async () => {
    const contact = await createContact(db, contactInput(), TODAY);
    if (!contact.ok) throw new Error("contact did not save");
    const deal = await makeDeal({ contactId: contact.data.id });

    await moveDeal(db, deal.id, "Deposit", TODAY);
    const rows = await db.select().from(timeline).where(eq(timeline.contactId, contact.data.id));
    expect(rows).toHaveLength(1);
  });

  it("is what Command's 'Deals moved · 7 days' counts", async () => {
    const deal = await makeDeal();
    const since = new Date(Date.now() - 7 * 86_400_000);
    expect(await stageMovesSince(db, since)).toBe(0);

    await moveDeal(db, deal.id, "Deposit", TODAY);
    await moveDeal(db, deal.id, "Building", TODAY);
    expect(await stageMovesSince(db, since)).toBe(2);

    // A move older than the window is not counted.
    await db.update(timeline).set({ createdAt: new Date("2026-01-01T00:00:00Z") });
    expect(await stageMovesSince(db, since)).toBe(0);
  });

  it("writes nothing when the stage does not actually change", async () => {
    const deal = await makeDeal();
    await moveDeal(db, deal.id, "Quote sent", TODAY);
    expect(await db.select().from(timeline)).toHaveLength(0);
  });

  it("refuses a stage that is not on the pipeline", async () => {
    const deal = await makeDeal();
    expect(await moveDeal(db, deal.id, "Nowhere", TODAY)).toMatchObject({ ok: false, error: { code: "bad_stage" } });
    expect(await db.select().from(timeline)).toHaveLength(0);
  });
});
