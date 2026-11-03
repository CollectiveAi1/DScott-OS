import { afterEach, beforeAll, describe, expect, it } from "vitest";

// The route reads the database through getDb(), so point the client at an in-memory PGlite
// before importing anything that touches it.
process.env.PGLITE_DIR = "memory://";
process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";

const SECRET = process.env.CRON_SECRET;

function tick(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/cron/tick", { headers });
}

let GET: (request: Request) => Promise<Response>;

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { getDb } = await import("../src/db/client");
  await migrate(getDb() as never, { migrationsFolder: "./drizzle" });
  ({ GET } = await import("../src/app/api/cron/tick/route"));
});

afterEach(() => {
  process.env.CRON_SECRET = SECRET;
});

describe("GET /api/cron/tick", () => {
  it("rejects a request with no credentials", async () => {
    const response = await GET(tick());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "Valid cron credentials are required." },
    });
  });

  it("rejects a wrong secret, a wrong-length secret and a missing Bearer scheme", async () => {
    expect((await GET(tick({ authorization: "Bearer nope" }))).status).toBe(401);
    expect((await GET(tick({ authorization: `Bearer ${SECRET}x` }))).status).toBe(401);
    expect((await GET(tick({ authorization: `Bearer ${SECRET?.slice(0, -1)}` }))).status).toBe(401);
    // The right secret with no scheme is still refused: Vercel Cron always sends Bearer.
    expect((await GET(tick({ authorization: SECRET as string }))).status).toBe(401);
  });

  it("says so when the deployment has no CRON_SECRET at all", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(tick({ authorization: "Bearer anything" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("cron_not_configured");
  });

  it("runs the registered jobs with the right secret", async () => {
    const response = await GET(tick({ authorization: `Bearer ${SECRET}` }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ran: { job: string; status: string; detail: string | null }[];
      skipped: { job: string; reason: string }[];
    };

    // Nothing has run before, so the interval jobs are due; the daily and weekly ones depend on
    // the local clock, so assert on the union instead of a fixed split.
    const names = [...body.ran.map((entry) => entry.job), ...body.skipped.map((entry) => entry.job)];
    expect(names).toEqual(["google-sync", "approvals-deliver", "daily-brief", "learning-review"]);

    // google-sync is real as of M4: with no calendars picked it skips and says why, rather
    // than reporting a milestone that has already shipped.
    const sync = body.ran.find((entry) => entry.job === "google-sync");
    expect(sync).toMatchObject({ job: "google-sync", status: "skipped" });
    expect(sync?.detail).toBe("No calendars are feeding Family yet.");

    // The jobs that have not shipped yet still say so.
    const approvals = body.ran.find((entry) => entry.job === "approvals-deliver");
    expect(approvals).toEqual({ job: "approvals-deliver", status: "skipped", detail: "Ships in M8." });
  });

  it("reports the interval jobs as not due on an immediate second tick", async () => {
    const response = await GET(tick({ authorization: `Bearer ${SECRET}` }));
    const body = (await response.json()) as { skipped: { job: string; reason: string }[] };
    expect(body.skipped.map((entry) => entry.job)).toContain("google-sync");
  });
});
