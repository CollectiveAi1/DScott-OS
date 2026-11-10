import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.PGLITE_DIR = "memory://";

let signedIn = true;
const redirected = new Error("redirected to /login");

// Run now is a server action, not a second cron route: it is reachable only with a session.
vi.mock("../src/lib/auth/session", () => ({
  requireOwner: async () => {
    if (!signedIn) throw redirected;
    return { name: "Devon", email: "devon@example.com" };
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const handlers: Record<string, () => Promise<{ status: "ok" | "skipped"; detail?: string }>> = {};

vi.mock("../src/modules/jobs/registry", () => ({
  JOBS: [
    {
      name: "test-job",
      // Weekly, so it is not due on most days — which is the case Run now exists for.
      schedule: { kind: "weeklyAfter", weekday: 7, time: "18:00" },
      purpose: "A job for the test.",
      handler: async () => handlers.run!(),
    },
  ],
}));

const { runJobNowAction } = await import("../src/modules/jobs/actions");
const { getDb } = await import("../src/db/client");
const { jobRuns } = await import("../src/db/schema");
const { migrate } = await import("drizzle-orm/pglite/migrator");

await migrate(getDb() as never, { migrationsFolder: "./drizzle" });

function form(job: string): FormData {
  const data = new FormData();
  data.set("job", job);
  return data;
}

beforeEach(async () => {
  signedIn = true;
  handlers.run = async () => ({ status: "ok", detail: "It worked." });
  await getDb().delete(jobRuns);
});

describe("runJobNowAction", () => {
  it("runs the job and reports what it did", async () => {
    const result = await runJobNowAction({}, form("test-job"));
    expect(result).toEqual({ ok: "Done. It worked." });
  });

  it("records the run, so a manual run shows in the history like a scheduled one", async () => {
    await runJobNowAction({}, form("test-job"));
    const runs = await getDb().select().from(jobRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ job: "test-job", status: "ok", detail: "It worked." });
  });

  it("runs even though the job is not due — that is the whole point of the button", async () => {
    // The registered schedule is Sunday after 18:00; the run happens regardless.
    await runJobNowAction({}, form("test-job"));
    await runJobNowAction({}, form("test-job"));
    expect(await getDb().select().from(jobRuns)).toHaveLength(2);
  });

  it("reports a failure without throwing, and still records it", async () => {
    handlers.run = async () => {
      throw new Error("The provider is not connected.");
    };
    const result = await runJobNowAction({}, form("test-job"));
    expect(result).toEqual({ error: "The provider is not connected." });

    const runs = await getDb().select().from(jobRuns);
    expect(runs[0]).toMatchObject({ status: "error" });
  });

  it("says plainly when a job had nothing to do", async () => {
    handlers.run = async () => ({ status: "skipped", detail: "Nothing due." });
    expect(await runJobNowAction({}, form("test-job"))).toEqual({ ok: "Nothing to do: Nothing due." });
  });

  it("refuses a job name that is not registered", async () => {
    const result = await runJobNowAction({}, form("rm -rf"));
    expect(result).toEqual({ error: "There is no job by that name." });
    expect(await getDb().select().from(jobRuns)).toHaveLength(0);
  });

  it("requires a session", async () => {
    signedIn = false;
    await expect(runJobNowAction({}, form("test-job"))).rejects.toThrow(redirected);
    expect(await getDb().select().from(jobRuns)).toHaveLength(0);
  });
});
