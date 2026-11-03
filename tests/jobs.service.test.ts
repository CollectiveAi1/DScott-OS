import { desc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { jobRuns } from "../src/db/schema";
import type { JobDefinition } from "../src/modules/jobs/registry";
import { runDueJobs, runJob, type JobContext } from "../src/modules/jobs/service";
import { freshDb } from "./helpers/db";

const ZONE = "America/New_York";
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});

function context(now = new Date()): JobContext {
  return { db, timeZone: ZONE, now };
}

function job(name: string, handler: JobDefinition["handler"]): JobDefinition {
  return { name, schedule: { kind: "interval", everyMinutes: 5 }, purpose: "test", handler };
}

async function rowsFor(name: string) {
  const all = await db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt));
  return all.filter((row) => row.job === name);
}

describe("runJob", () => {
  it("records a successful run with a duration", async () => {
    const run = await runJob(job("ok-job", async () => ({ status: "ok", detail: "3 events" })), context());
    expect(run.status).toBe("ok");
    expect(run.detail).toBe("3 events");
    expect(run.finishedAt.getTime()).toBeGreaterThanOrEqual(run.startedAt.getTime());
    expect(await rowsFor("ok-job")).toHaveLength(1);
  });

  it("records a skipped run", async () => {
    const run = await runJob(job("stub-job", async () => ({ status: "skipped", detail: "Ships in M4." })), context());
    expect(run.status).toBe("skipped");
    expect(run.detail).toBe("Ships in M4.");
  });

  it("never throws, and records the failure instead", async () => {
    const run = await runJob(
      job("throwing-job", async () => {
        throw new Error("Google returned 500");
      }),
      context(),
    );
    expect(run.status).toBe("error");
    expect(run.detail).toBe("Google returned 500");
    expect(await rowsFor("throwing-job")).toHaveLength(1);
  });

  it("survives a handler that throws a non-Error", async () => {
    const run = await runJob(
      job("odd-job", async () => {
        throw "just a string";
      }),
      context(),
    );
    expect(run.status).toBe("error");
    expect(run.detail).toBe("Unknown failure.");
  });

  it("keeps the recorded detail to one line", async () => {
    const run = await runJob(
      job("multiline-job", async () => {
        throw new Error("line one\n  line two\n\tline three");
      }),
      context(),
    );
    expect(run.detail).toBe("line one line two line three");
  });
});

describe("runDueJobs", () => {
  it("runs a due job and reports a not-due job as skipped", async () => {
    const first = job("tick-a", async () => ({ status: "ok" }));
    const result = await runDueJobs(context(), [first]);
    expect(result.ran).toEqual([{ job: "tick-a", status: "ok", detail: null }]);

    // Immediately again: inside the 5-minute window, so it is not due.
    const second = await runDueJobs(context(), [first]);
    expect(second.ran).toHaveLength(0);
    expect(second.skipped).toEqual([{ job: "tick-a", reason: "Not due yet." }]);
    expect(await rowsFor("tick-a")).toHaveLength(1);
  });

  it("keeps going after a job fails, and records both", async () => {
    const order: string[] = [];
    const result = await runDueJobs(context(), [
      job("fails-first", async () => {
        order.push("fails-first");
        throw new Error("boom");
      }),
      job("runs-second", async () => {
        order.push("runs-second");
        return { status: "ok", detail: "still ran" };
      }),
    ]);

    expect(order).toEqual(["fails-first", "runs-second"]);
    expect(result.ran).toEqual([
      { job: "fails-first", status: "error", detail: "boom" },
      { job: "runs-second", status: "ok", detail: "still ran" },
    ]);
  });

  it("runs jobs in registry order, one at a time", async () => {
    const order: string[] = [];
    const slow = (name: string) =>
      job(name, async () => {
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`${name}:end`);
        return { status: "ok" as const };
      });
    await runDueJobs(context(), [slow("seq-1"), slow("seq-2")]);
    expect(order).toEqual(["seq-1:start", "seq-1:end", "seq-2:start", "seq-2:end"]);
  });

  it("re-runs once the window has passed", async () => {
    const definition = job("windowed", async () => ({ status: "ok" }));
    const start = new Date("2026-11-02T15:00:00Z");
    await runDueJobs(context(start), [definition]);
    const later = await runDueJobs(context(new Date("2026-11-02T15:10:00Z")), [definition]);
    expect(later.ran).toHaveLength(1);
  });
});
