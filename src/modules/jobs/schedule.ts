import { dateInZone, minutesOfDay, timeInZone, weekdayInZone } from "@/lib/dates";

/**
 * Three shapes cover every v1 job. Everything here is pure: the cron route reads the last run
 * per job from the database and asks these functions whether to run, so the decision is testable
 * without a clock or a connection.
 */
export type JobSchedule =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "dailyAfter"; time: string }
  | { kind: "weeklyAfter"; weekday: number; time: string };

// A 5-minute cron that fires at 9 min 58 s would otherwise defer a 10-minute job a whole tick.
const INTERVAL_GRACE_MS = 60_000;

export function describeSchedule(schedule: JobSchedule): string {
  switch (schedule.kind) {
    case "interval":
      return `Every ${schedule.everyMinutes} min`;
    case "dailyAfter":
      return `Daily after ${schedule.time}`;
    case "weeklyAfter":
      return `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][schedule.weekday - 1]} after ${schedule.time}`;
  }
}

/**
 * Whether a job should run on this tick. `lastRunStartedAt` is the start of the most recent
 * recorded run of that job, whatever its status: a job that failed waits for its next window
 * rather than retrying every tick.
 */
export function isJobDue(
  schedule: JobSchedule,
  lastRunStartedAt: Date | null,
  now: Date,
  timeZone: string,
): boolean {
  if (schedule.kind === "interval") {
    if (!lastRunStartedAt) return true;
    const elapsed = now.getTime() - lastRunStartedAt.getTime();
    return elapsed >= schedule.everyMinutes * 60_000 - INTERVAL_GRACE_MS;
  }

  if (schedule.kind === "weeklyAfter" && weekdayInZone(now, timeZone) !== schedule.weekday) return false;
  if (minutesOfDay(timeInZone(now, timeZone)) < minutesOfDay(schedule.time)) return false;
  // Once per local day: a run already recorded today means this window is used up.
  if (!lastRunStartedAt) return true;
  return dateInZone(lastRunStartedAt, timeZone) !== dateInZone(now, timeZone);
}
