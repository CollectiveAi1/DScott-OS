import type { JobSchedule } from "./schedule";
import type { JobHandler } from "./service";

export type JobDefinition = {
  name: string;
  schedule: JobSchedule;
  /** Shown in Settings so Devon can see what each job is for. */
  purpose: string;
  handler: JobHandler;
};

/**
 * All four v1 jobs are registered now so the schedule, the recording and the response shape are
 * provable before any integration exists. Each milestone replaces one stub with a real body and
 * changes nothing else here.
 */
function notYetBuilt(milestone: string): JobHandler {
  return async () => ({ status: "skipped", detail: `Ships in ${milestone}.` });
}

// Registry order is execution order.
export const JOBS: JobDefinition[] = [
  {
    name: "google-sync",
    schedule: { kind: "interval", everyMinutes: 10 },
    purpose: "Pulls the Family calendar from Google.",
    handler: async () => {
      const { syncAllCalendars } = await import("@/modules/google/service");
      const result = await syncAllCalendars();
      if (!result.ok) {
        // Not connected or no calendars picked is a state, not a failure. A revoked grant is
        // already recorded on the connection, and the job stops rather than retrying.
        return { status: "skipped", detail: result.error.message };
      }
      const { calendars, written, removed, errors } = result.data;
      const detail = `${calendars} calendar(s): ${written} written, ${removed} removed`;
      if (errors.length > 0) throw new Error(`${detail}. ${errors.join("; ")}`);
      return { status: "ok", detail };
    },
  },
  {
    name: "approvals-deliver",
    schedule: { kind: "interval", everyMinutes: 5 },
    purpose: "Delivers approvals Devon has said yes to, in live mode only.",
    handler: async ({ db, now }) => {
      const { deliverDue } = await import("@/modules/approvals/service");
      const summary = await deliverDue(db, { now });

      if (summary.claimed === 0 && summary.swept === 0) {
        return { status: "skipped", detail: "Nothing due." };
      }
      const detail = `${summary.claimed} due: ${summary.sent} sent, ${summary.failed} failed${
        summary.swept > 0 ? `, ${summary.swept} swept` : ""
      }`;
      // A failure is the normal case in v1 — no provider is connected — so it is recorded as a
      // failed run with the reason rather than passed off as a success.
      if (summary.failed > 0) throw new Error(`${detail}. ${summary.reasons.join("; ")}`);
      return { status: "ok", detail };
    },
  },
  {
    name: "daily-brief",
    schedule: { kind: "dailyAfter", time: "06:30" },
    purpose: "Writes the morning brief.",
    handler: notYetBuilt("M9"),
  },
  {
    name: "learning-review",
    schedule: { kind: "weeklyAfter", weekday: 7, time: "18:00" },
    purpose: "Writes the weekly learning review.",
    handler: async ({ db, timeZone, now }) => {
      const { dateInZone } = await import("@/lib/dates");
      const { writeLearningReview } = await import("@/modules/learning/service");

      const result = await writeLearningReview(db, dateInZone(now, timeZone));
      if (!result.ok) throw new Error(result.error.message);
      return {
        status: "ok",
        detail: `${result.data.review.skills.length} skill(s), ${result.data.review.totals.thisWeek} min this week (${result.data.source})`,
      };
    },
  },
];
