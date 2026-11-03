import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.PGLITE_DIR = "memory://";

type ExportBody = {
  exportedAt: string;
  timezone: string;
  tables: Record<string, Record<string, unknown>[]>;
};

let GET: () => Promise<Response>;
let signedIn = true;

// The route re-checks the session itself; the cookie plumbing belongs to the auth tests.
vi.mock("../src/lib/auth/session", () => ({
  currentOwner: async () => (signedIn ? { name: "Devon", email: "devon@example.com" } : null),
}));

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { getDb } = await import("../src/db/client");
  const db = getDb();
  await migrate(db as never, { migrationsFolder: "./drizzle" });

  const { owner, settings, tasks } = await import("../src/db/schema");
  await db.insert(owner).values({
    id: 1,
    name: "Devon",
    email: "devon@example.com",
    passwordHash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
  });
  await db
    .insert(settings)
    .values({ id: 1, timezone: "America/New_York", encryptedKeys: { google: "v1:aaa:bbb:ccc" } });
  await db.insert(tasks).values({ title: "Call coach re: film session", arena: "basketball" });

  ({ GET } = await import("../src/app/api/export/route"));
});

describe("GET /api/export", () => {
  it("refuses a request without a session", async () => {
    signedIn = false;
    const response = await GET();
    signedIn = true;
    expect(response.status).toBe(401);
  });

  it("downloads valid JSON as a dated attachment", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="dscott-os-export-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const body = JSON.parse(await response.text()) as ExportBody;
    expect(body.timezone).toBe("America/New_York");
    expect(Date.parse(body.exportedAt)).not.toBeNaN();
  });

  it("includes every table in the schema, and the rows in them", async () => {
    const body = JSON.parse(await (await GET()).text()) as ExportBody;
    for (const table of [
      "owner",
      "settings",
      "orgs",
      "contacts",
      "pipelines",
      "deals",
      "projects",
      "boards",
      "tasks",
      "calendarEvents",
      "skills",
      "learningItems",
      "practiceLog",
      "timeline",
      "approvals",
      "jobRuns",
    ]) {
      expect(body.tables, `missing table ${table}`).toHaveProperty(table);
    }
    expect(body.tables.tasks?.[0]).toMatchObject({ title: "Call coach re: film session", arena: "basketball" });
  });

  it("withholds the password hash and the encrypted keys", async () => {
    const text = await (await GET()).text();
    const body = JSON.parse(text) as ExportBody;

    expect(body.tables.owner?.[0]).toMatchObject({ name: "Devon" });
    expect(body.tables.owner?.[0]).not.toHaveProperty("passwordHash");
    expect(body.tables.settings?.[0]).not.toHaveProperty("encryptedKeys");
    // Scan the serialised file, not just the parsed objects: no secret in any shape.
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("encryptedKeys");
    expect(text).not.toContain("scrypt$");
    expect(text).not.toContain("v1:aaa:bbb:ccc");
  });
});
