import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobRuns } from "@/db/schema";
import { JOBS, type JobDefinition } from "./registry";
import { isJobDue } from "./schedule";

export type JobRun = typeof jobRuns.$inferSelect;
export type JobOutcome = { status: "ok" | "skipped"; detail?: string };
export type JobContext = { db: Db; timeZone: string; now: Date };
export type JobHandler = (context: JobContext) => Promise<JobOutcome>;

export type TickResult = {
  ran: { job: string; status: JobRun["status"]; detail: string | null }[];
  skipped: { job: string; reason: string }[];
};

const MAX_DETAIL = 300;

/** One line for Devon. Never a stack trace, a DB error body or anything resembling a token. */
function detailFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL) || "Unknown failure.";
}

/**
 * Runs one job and records it. Never throws to the caller: a job that fails is a row with
 * status "error", so one broken job cannot take down the tick that called it.
 */
export async function runJob(definition: JobDefinition, context: JobContext): Promise<JobRun> {
  // One tick, one clock: the run is stamped from context.now, which is also what the due check
  // compares against. Duration is measured separately and added to it.
  const startedAt = context.now;
  const startedTicks = Date.now();
  let status: JobRun["status"] = "ok";
  let detail: string | null = null;

  try {
    const outcome = await definition.handler(context);
    status = outcome.status;
    detail = outcome.detail?.slice(0, MAX_DETAIL) ?? null;
  } catch (error) {
    status = "error";
    detail = detailFromError(error);
    console.error(JSON.stringify({ event: "job_failed", job: definition.name, detail }));
  }

  const finishedAt = new Date(startedAt.getTime() + (Date.now() - startedTicks));
  const values = { job: definition.name, startedAt, finishedAt, status, detail };
  try {
    const [row] = await context.db.insert(jobRuns).values(values).returning();
    if (row) return row;
  } catch (error) {
    // The job itself may well have succeeded; losing its record must still not throw upward.
    console.error(
      JSON.stringify({ event: "job_run_not_recorded", job: definition.name, detail: detailFromError(error) }),
    );
  }
  return { id: "", createdAt: startedAt, updatedAt: startedAt, ...values };
}

/** The most recent run of each given job, whatever its status. */
async function lastRunByJob(db: Db, jobs: JobDefinition[]): Promise<Map<string, Date>> {
  const entries = await Promise.all(
    jobs.map(async ({ name }) => {
      const [row] = await db
        .select({ startedAt: jobRuns.startedAt })
        .from(jobRuns)
        .where(eq(jobRuns.job, name))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
      return [name, row?.startedAt] as const;
    }),
  );
  return new Map(entries.filter((entry): entry is [string, Date] => entry[1] instanceof Date));
}

/**
 * Runs every due job in registry order. Jobs run in sequence and a failure is recorded rather
 * than thrown, so a failed job never blocks the others in the same tick.
 */
export async function runDueJobs(
  context: Omit<JobContext, "db"> & { db: Db },
  jobs: JobDefinition[] = JOBS,
): Promise<TickResult> {
  const lastRuns = await lastRunByJob(context.db, jobs);
  const result: TickResult = { ran: [], skipped: [] };

  for (const definition of jobs) {
    const lastRun = lastRuns.get(definition.name) ?? null;
    if (!isJobDue(definition.schedule, lastRun, context.now, context.timeZone)) {
      result.skipped.push({ job: definition.name, reason: "Not due yet." });
      continue;
    }
    const run = await runJob(definition, context);
    result.ran.push({ job: run.job, status: run.status, detail: run.detail });
  }

  console.info(JSON.stringify({ event: "cron_tick", ran: result.ran.length, skipped: result.skipped.length }));
  return result;
}
