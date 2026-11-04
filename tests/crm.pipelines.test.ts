import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { deals, pipelines, tasks, timeline } from "../src/db/schema";
import { createDeal, updateDeal, updatePipelineStages, type DealInput } from "../src/modules/crm/service";
import { freshDb } from "./helpers/db";

const TODAY = "2026-11-05";
const STAGES = ["Lead", "Scope call", "Quote sent", "Deposit", "Building"];

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
  await db.delete(pipelines);
  const [pipeline] = await db
    .insert(pipelines)
    .values({ name: "Client builds", stages: STAGES, billingStages: ["Deposit"] })
    .returning();
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

async function makeDeal(overrides: Partial<DealInput> = {}) {
  const result = await createDeal(db, dealInput(overrides), TODAY);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const reload = async () => (await db.select().from(pipelines).where(eq(pipelines.id, pipelineId)))[0]!;

describe("updatePipelineStages · renaming", () => {
  it("moves the deals standing in a renamed stage", async () => {
    const deal = await makeDeal({ stage: "Quote sent" });

    const renamed = [...STAGES];
    renamed[2] = "Proposal sent";
    const result = await updatePipelineStages(db, pipelineId, { stages: renamed, billingStages: ["Deposit"] });

    expect(result.ok).toBe(true);
    expect((await reload()).stages[2]).toBe("Proposal sent");
    // The deal moved with the name: a rename must not orphan it.
    const [after] = await db.select().from(deals).where(eq(deals.id, deal.id));
    expect(after?.stage).toBe("Proposal sent");
  });

  it("keeps a billing stage billing when it is renamed", async () => {
    const renamed = [...STAGES];
    renamed[3] = "Deposit received";
    await updatePipelineStages(db, pipelineId, { stages: renamed, billingStages: ["Deposit received"] });
    expect((await reload()).billingStages).toEqual(["Deposit received"]);
  });

  it("carries the billing flag through a rename even when the form posts the old name", async () => {
    // What the screen actually submits: the ticked boxes still read "Deposit" while the text
    // area already says "Deposit received". Dropping it would silently stop invoices.
    const renamed = [...STAGES];
    renamed[3] = "Deposit received";
    await updatePipelineStages(db, pipelineId, { stages: renamed, billingStages: ["Deposit"] });
    expect((await reload()).billingStages).toEqual(["Deposit received"]);
  });

  it("still raises an invoice after the billing stage was renamed", async () => {
    const deal = await makeDeal({ stage: "Lead" });
    const renamed = [...STAGES];
    renamed[3] = "Deposit received";
    await updatePipelineStages(db, pipelineId, { stages: renamed, billingStages: ["Deposit"] });

    await updateDeal(db, deal.id, dealInput({ stage: "Deposit received" }), TODAY);
    expect(await db.select().from(tasks).where(eq(tasks.owner, "Ahmad"))).toHaveLength(1);
  });
});

describe("updatePipelineStages · removing", () => {
  it("refuses to remove a stage that still has deals in it, and says how many", async () => {
    await makeDeal({ stage: "Quote sent" });
    await makeDeal({ title: "Another", stage: "Quote sent" });

    const without = STAGES.filter((stage) => stage !== "Quote sent");
    const result = await updatePipelineStages(db, pipelineId, { stages: without, billingStages: ["Deposit"] });

    expect(result).toMatchObject({ ok: false, error: { code: "stage_in_use" } });
    if (!result.ok) expect(result.error.message).toContain("2 deals");
    // Nothing changed.
    expect((await reload()).stages).toEqual(STAGES);
  });

  it("allows removing an empty stage", async () => {
    const without = STAGES.filter((stage) => stage !== "Building");
    expect((await updatePipelineStages(db, pipelineId, { stages: without, billingStages: ["Deposit"] })).ok).toBe(true);
    expect((await reload()).stages).toEqual(without);
  });

  it("drops a billing stage that is no longer a stage", async () => {
    const without = STAGES.filter((stage) => stage !== "Deposit");
    await updatePipelineStages(db, pipelineId, { stages: without, billingStages: ["Deposit"] });
    expect((await reload()).billingStages).toEqual([]);
  });
});

describe("updatePipelineStages · refusals", () => {
  it("refuses an empty list of stages", async () => {
    expect(await updatePipelineStages(db, pipelineId, { stages: [], billingStages: [] })).toMatchObject({
      ok: false,
      error: { code: "no_stages" },
    });
  });

  it("refuses two stages with the same name", async () => {
    expect(
      await updatePipelineStages(db, pipelineId, { stages: ["Lead", "Lead"], billingStages: [] }),
    ).toMatchObject({ ok: false, error: { code: "duplicate_stage" } });
  });

  it("ignores blank entries rather than creating a nameless stage", async () => {
    const result = await updatePipelineStages(db, pipelineId, {
      stages: ["Lead", "   ", "Won"],
      billingStages: [],
    });
    // Three entries become two stages, which is a removal — and "Scope call" onwards are empty.
    expect(result.ok).toBe(true);
    expect((await reload()).stages).toEqual(["Lead", "Won"]);
  });
});

describe("adding a billing stage later", () => {
  it("hands off the next time a deal arrives there", async () => {
    const deal = await makeDeal({ stage: "Lead" });
    await updatePipelineStages(db, pipelineId, { stages: STAGES, billingStages: ["Deposit", "Building"] });

    await updateDeal(db, deal.id, dealInput({ stage: "Building" }), TODAY);
    const handoffs = await db.select().from(tasks).where(eq(tasks.owner, "Ahmad"));
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.title).toContain("Invoice: Daycare site build");
  });
});

describe("editing a deal through the form", () => {
  it("records the stage move it caused", async () => {
    const deal = await makeDeal({ stage: "Lead" });
    await updateDeal(db, deal.id, dealInput({ stage: "Quote sent" }), TODAY);

    const rows = await db.select().from(timeline).where(eq(timeline.dealId, deal.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("Lead → Quote sent");
  });

  it("records nothing when the stage did not change", async () => {
    const deal = await makeDeal({ stage: "Lead" });
    await updateDeal(db, deal.id, dealInput({ stage: "Lead", title: "Renamed" }), TODAY);
    expect(await db.select().from(timeline)).toHaveLength(0);
  });

  it("refuses a stage that is not on the pipeline", async () => {
    const deal = await makeDeal();
    expect(await updateDeal(db, deal.id, dealInput({ stage: "Nowhere" }), TODAY)).toMatchObject({
      ok: false,
      error: { code: "bad_stage" },
    });
  });
});
