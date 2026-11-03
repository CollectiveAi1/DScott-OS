import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobRuns } from "@/db/schema";
import { JOBS } from "./registry";
import type { JobRun } from "./service";

/**
 * The last `perJob` runs of every registered job, newest first. One indexed query per job rather
 * than one global one: approvals-deliver runs twelve times an hour and would otherwise crowd
 * daily-brief out of any shared limit.
 */
export async function recentRunsByJob(db: Db, perJob = 10): Promise<Map<string, JobRun[]>> {
  const entries = await Promise.all(
    JOBS.map(async ({ name }) => {
      const rows = await db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.job, name))
        .orderBy(desc(jobRuns.startedAt))
        .limit(perJob);
      return [name, rows] as const;
    }),
  );
  return new Map(entries);
}
