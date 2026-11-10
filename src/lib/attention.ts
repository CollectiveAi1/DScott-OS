import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, deals, jobRuns, pipelines } from "@/db/schema";
import { recipientOf } from "@/modules/approvals/payloads";
import { formatCents } from "@/modules/crm/money";

/**
 * One thing that has gone wrong and is waiting on Devon.
 *
 * `detail` always says what clears it. A panel that lists problems without saying what to do
 * about them becomes wallpaper, and the whole point of this one is that it is read.
 */
export type AttentionItem = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  href: string;
  /** Lower sorts first. Not the source — how much it costs to ignore. */
  weight: number;
};

/** A job failure older than this is history, not something to act on this morning. */
export const JOB_FAILURE_HOURS = 24;

export const WEIGHT = {
  connection: 0,
  failedApproval: 1,
  failedJob: 2,
  staleCapture: 3,
  staleDeal: 4,
} as const;

/** Approvals that tried to go out and could not. Each one is a message nobody received. */
export async function failedApprovals(db: Db, limit = 10): Promise<AttentionItem[]> {
  const rows = await db
    .select()
    .from(approvals)
    .where(eq(approvals.status, "failed"))
    .orderBy(desc(approvals.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: `approval:${row.id}`,
    kind: "Failed approval",
    title: `${row.kind.replace("_", " ")} to ${recipientOf(row.kind, row.payload)}`,
    detail: `${row.failureReason ?? "It failed."} Send it back to Waiting from Approvals, or reject it.`,
    href: "/approvals?tab=failed",
    weight: WEIGHT.failedApproval,
  }));
}

/**
 * Jobs that errored in the last day.
 *
 * One row per job, not per run: `approvals-deliver` fails on every tick while no provider is
 * connected, and twelve identical rows would bury everything else.
 */
export async function failedJobs(db: Db, now: Date): Promise<AttentionItem[]> {
  const since = new Date(now.getTime() - JOB_FAILURE_HOURS * 3_600_000);
  const rows = await db
    .select({ job: jobRuns.job, detail: jobRuns.detail, startedAt: jobRuns.startedAt })
    .from(jobRuns)
    .where(and(eq(jobRuns.status, "error"), gte(jobRuns.startedAt, since)))
    .orderBy(desc(jobRuns.startedAt))
    .limit(50);

  const seen = new Set<string>();
  const items: AttentionItem[] = [];
  for (const row of rows) {
    if (seen.has(row.job)) continue;
    seen.add(row.job);
    items.push({
      id: `job:${row.job}`,
      kind: "Failed job",
      title: `${row.job} failed`,
      detail: `${row.detail ?? "No reason was recorded."} Run it again from Settings once the cause is fixed.`,
      href: "/settings",
      weight: WEIGHT.failedJob,
    });
  }
  return items;
}

/**
 * Deals with nothing scheduled to happen next, or something that should already have happened.
 *
 * One row each rather than one row saying "5 deals": the next-step discipline is per deal, and a
 * count is not something you can act on.
 */
export async function stalledDeals(db: Db, today: string, limit = 10): Promise<AttentionItem[]> {
  const noStep = or(isNull(deals.nextStep), sql`btrim(${deals.nextStep}) = ''`);
  // A next step with no date is not overdue; it is just undated, which is Devon's call.
  const overdueStep = and(sql`btrim(coalesce(${deals.nextStep}, '')) <> ''`, lt(deals.nextStepDue, today));

  const rows = await db
    .select({ deal: deals, pipeline: pipelines.name })
    .from(deals)
    .innerJoin(pipelines, eq(deals.pipelineId, pipelines.id))
    .where(or(noStep, overdueStep))
    .orderBy(sql`${deals.nextStepDue} asc nulls first`, desc(deals.valueCents))
    .limit(limit);

  return rows.map(({ deal, pipeline }) => {
    const step = deal.nextStep?.trim();
    return {
      id: `deal:${deal.id}`,
      kind: step ? "Overdue next step" : "No next step",
      title: `${deal.title} · ${formatCents(deal.valueCents)}`,
      detail: step
        ? `"${step}" was due ${deal.nextStepDue}. Do it, or move the date, on ${pipeline}.`
        : `In ${pipeline} at ${deal.stage} with nothing scheduled next. Give it one on Pipelines.`,
      href: "/pipelines",
      weight: WEIGHT.staleDeal,
    };
  });
}

/** Everything that needs Devon, worst first. */
export function order(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => a.weight - b.weight || a.title.localeCompare(b.title));
}
