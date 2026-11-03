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
    handler: notYetBuilt("M4"),
  },
  {
    name: "approvals-deliver",
    schedule: { kind: "interval", everyMinutes: 5 },
    purpose: "Delivers approvals Devon has said yes to, in live mode only.",
    handler: notYetBuilt("M8"),
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
    handler: notYetBuilt("M7"),
  },
];
