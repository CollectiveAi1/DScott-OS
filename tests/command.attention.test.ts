import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { approvals, contacts, deals, jobRuns, pipelines } from "../src/db/schema";
import { failedApprovals, failedJobs, JOB_FAILURE_HOURS, order, stalledDeals, WEIGHT } from "../src/lib/attention";
import { freshDb } from "./helpers/db";

const TODAY = "2026-11-10";
const NOW = new Date("2026-11-10T12:00:00Z");

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.delete(approvals);
  await db.delete(contacts);
  await db.delete(jobRuns);
  await db.delete(deals);
  await db.delete(pipelines);
});

let keys = 0;

describe("failedApprovals", () => {
  async function anApproval(overrides: Partial<typeof approvals.$inferInsert> = {}) {
    const [row] = await db
      .insert(approvals)
      .values({
        kind: "email",
        payload: { to: "rosa@example.com", subject: "The quote", body: "Attached." },
        idempotencyKey: `k${++keys}`,
        status: "failed",
        failureReason: "No email provider connected.",
        ...overrides,
      })
      .returning();
    return row!;
  }

  it("lists a failed approval with its reason and what clears it", async () => {
    await anApproval();
    const [item] = await failedApprovals(db);
    expect(item).toMatchObject({
      kind: "Failed approval",
      title: "email to rosa@example.com",
      href: "/approvals?tab=failed",
      weight: WEIGHT.failedApproval,
    });
    expect(item?.detail).toContain("No email provider connected.");
    expect(item?.detail).toContain("back to Waiting");
  });

  it("ignores approvals in every other state", async () => {
    for (const status of ["waiting", "scheduled", "sending", "sent", "rejected"] as const) {
      await anApproval({ status, failureReason: null });
    }
    expect(await failedApprovals(db)).toEqual([]);
  });

  it("says something sensible when no reason was recorded", async () => {
    await anApproval({ failureReason: null });
    const [item] = await failedApprovals(db);
    expect(item?.detail).toContain("It failed.");
  });
});

describe("failedJobs", () => {
  async function aRun(job: string, status: "ok" | "error" | "skipped", hoursAgo: number, detail = "It broke.") {
    await db.insert(jobRuns).values({
      job,
      status,
      detail,
      startedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
      finishedAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
    });
  }

  it("reports a failure from within the last day", async () => {
    await aRun("google-sync", "error", 2, "Token refresh failed.");
    const [item] = await failedJobs(db, NOW);
    expect(item).toMatchObject({ kind: "Failed job", title: "google-sync failed", weight: WEIGHT.failedJob });
    expect(item?.detail).toContain("Token refresh failed.");
    expect(item?.detail).toContain("Run it again from Settings");
  });

  it("ignores a failure older than the window", async () => {
    await aRun("google-sync", "error", JOB_FAILURE_HOURS + 1);
    expect(await failedJobs(db, NOW)).toEqual([]);
  });

  it("keeps one exactly on the boundary", async () => {
    await aRun("google-sync", "error", JOB_FAILURE_HOURS);
    expect(await failedJobs(db, NOW)).toHaveLength(1);
  });

  it("ignores ok and skipped runs", async () => {
    await aRun("google-sync", "ok", 1);
    await aRun("daily-brief", "skipped", 1);
    expect(await failedJobs(db, NOW)).toEqual([]);
  });

  it("gives one row per job, however often it failed", async () => {
    // approvals-deliver fails on every tick while no provider is connected.
    for (const hours of [1, 2, 3, 4, 5]) await aRun("approvals-deliver", "error", hours);
    const items = await failedJobs(db, NOW);
    expect(items).toHaveLength(1);
  });

  it("reports the most recent failure of each job", async () => {
    await aRun("google-sync", "error", 5, "Old reason.");
    await aRun("google-sync", "error", 1, "Newest reason.");
    const [item] = await failedJobs(db, NOW);
    expect(item?.detail).toContain("Newest reason.");
  });
});

describe("stalledDeals", () => {
  async function aPipeline() {
    const [row] = await db
      .insert(pipelines)
      .values({ name: "Client builds", stages: ["Deposit", "Build"] })
      .returning();
    return row!;
  }

  it("flags a deal with no next step and says where to give it one", async () => {
    const pipeline = await aPipeline();
    await db.insert(deals).values({ title: "Bright Start site", pipelineId: pipeline.id, stage: "Deposit", valueCents: 125000 });

    const [item] = await stalledDeals(db, TODAY);
    expect(item).toMatchObject({ kind: "No next step", title: "Bright Start site · $1,250.00", href: "/pipelines" });
    expect(item?.detail).toContain("Client builds");
    expect(item?.detail).toContain("Pipelines");
  });

  it("treats a blank next step as no next step", async () => {
    const pipeline = await aPipeline();
    await db.insert(deals).values({ title: "Blank", pipelineId: pipeline.id, stage: "Deposit", nextStep: "   " });
    expect((await stalledDeals(db, TODAY))[0]?.kind).toBe("No next step");
  });

  it("flags an overdue next step with its date", async () => {
    const pipeline = await aPipeline();
    await db
      .insert(deals)
      .values({ title: "Late", pipelineId: pipeline.id, stage: "Deposit", nextStep: "Chase the deposit", nextStepDue: "2026-11-01" });

    const [item] = await stalledDeals(db, TODAY);
    expect(item?.kind).toBe("Overdue next step");
    expect(item?.detail).toContain("2026-11-01");
  });

  it("leaves alone a deal whose next step is due today or later", async () => {
    const pipeline = await aPipeline();
    await db.insert(deals).values([
      { title: "Today", pipelineId: pipeline.id, stage: "Deposit", nextStep: "Call", nextStepDue: TODAY },
      { title: "Later", pipelineId: pipeline.id, stage: "Deposit", nextStep: "Call", nextStepDue: "2026-12-01" },
    ]);
    expect(await stalledDeals(db, TODAY)).toEqual([]);
  });

  it("leaves alone a next step with no date at all", async () => {
    const pipeline = await aPipeline();
    await db.insert(deals).values({ title: "Undated", pipelineId: pipeline.id, stage: "Deposit", nextStep: "Call sometime" });
    expect(await stalledDeals(db, TODAY)).toEqual([]);
  });

  it("gives one row per deal rather than a count", async () => {
    const pipeline = await aPipeline();
    await db.insert(deals).values(
      ["A", "B", "C"].map((title) => ({ title, pipelineId: pipeline.id, stage: "Deposit" })),
    );
    expect(await stalledDeals(db, TODAY)).toHaveLength(3);
  });
});

describe("order", () => {
  const item = (weight: number, title: string) => ({ id: title, kind: "k", title, detail: "d", href: "/", weight });

  it("puts what costs most to ignore first", () => {
    const sorted = order([
      item(WEIGHT.staleDeal, "a deal"),
      item(WEIGHT.connection, "a connection"),
      item(WEIGHT.failedJob, "a job"),
      item(WEIGHT.failedApproval, "an approval"),
      item(WEIGHT.staleCapture, "a capture"),
    ]);
    expect(sorted.map((row) => row.title)).toEqual([
      "a connection",
      "an approval",
      "a job",
      "a capture",
      "a deal",
    ]);
  });

  it("is stable within a weight, so the panel does not shuffle between loads", () => {
    const sorted = order([item(WEIGHT.staleDeal, "Beta"), item(WEIGHT.staleDeal, "Alpha")]);
    expect(sorted.map((row) => row.title)).toEqual(["Alpha", "Beta"]);
  });

  it("leaves an empty list empty, so the panel can hide itself", () => {
    expect(order([])).toEqual([]);
  });
});
