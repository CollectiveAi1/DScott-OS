import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";

const ZONE = "America/New_York";
// 15:00 UTC on 2026-11-02 is 10:00 in New York, so "today" is unambiguous.
const NOW = new Date("2026-11-02T15:00:00Z");

let loadCommand: typeof import("../src/lib/command").loadCommand;
let db: import("../src/db/client").Db;
let tasks: typeof import("../src/db/schema").tasks;
let captureTask: typeof import("../src/modules/work/service").captureTask;
let completeTask: typeof import("../src/modules/work/service").completeTask;
let triageTask: typeof import("../src/modules/work/service").triageTask;

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = await import("../src/db/client");
  db = client.getDb();
  await migrate(db as never, { migrationsFolder: "./drizzle" });

  ({ tasks } = await import("../src/db/schema"));
  ({ captureTask, completeTask, triageTask } = await import("../src/modules/work/service"));
  ({ loadCommand } = await import("../src/lib/command"));
});

beforeEach(async () => {
  await db.delete(tasks);
});

async function capture(line: string) {
  const result = await captureTask(db, { line, today: "2026-11-02" });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

async function triage(taskId: string) {
  const result = await triageTask(db, {
    taskId,
    arena: "basketball",
    boardId: null,
    boardColumn: null,
    due: "2026-11-04",
    priority: "high",
  });
  if (!result.ok) throw new Error(result.error.message);
}

describe("Command · due this week", () => {
  it("lists dated work whether or not it has been triaged, and agrees with the tile", async () => {
    // A capture with a date is due. Filing it onto a board is clerical; the date is the commitment.
    const captured = await capture("Still deciding what this is due:2026-11-04");
    const sorted = await capture("Call coach re: film session");
    await triage(sorted.id);
    await capture("No date on this one");

    const snapshot = await loadCommand(ZONE, NOW);
    const titles = snapshot.dueList.map((task) => task.title);
    expect(titles).toContain("Call coach re: film session");
    expect(titles).toContain("Still deciding what this is");
    expect(titles).not.toContain("No date on this one");
    expect(captured.fromMisc).toBe(true);
    // The count under "Due this week" has to reconcile with the list beneath it.
    expect(snapshot.dueThisWeek).toBe(titles.length);
  });

  it("drops a task from the due list once it is completed", async () => {
    const task = await capture("Call coach re: film session");
    await triage(task.id);
    expect((await loadCommand(ZONE, NOW)).dueList.map((row) => row.title)).toContain("Call coach re: film session");

    await completeTask(db, task.id, NOW);

    const after = await loadCommand(ZONE, NOW);
    expect(after.dueList.map((row) => row.title)).not.toContain("Call coach re: film session");
    expect(after.dueThisWeek).toBe(0);
  });
});

describe("Command · needs attention", () => {
  it("raises a capture left untriaged for more than seven days", async () => {
    const stale = await capture("Been sitting here");
    const recent = await capture("Captured on Friday");
    await db.update(tasks).set({ createdAt: new Date("2026-10-20T09:00:00Z") }).where(eq(tasks.id, stale.id));
    await db.update(tasks).set({ createdAt: new Date("2026-10-27T09:00:00Z") }).where(eq(tasks.id, recent.id));

    const snapshot = await loadCommand(ZONE, NOW);
    expect(snapshot.needsAttention).toHaveLength(1);
    expect(snapshot.needsAttention[0]).toMatchObject({
      kind: "Untriaged capture",
      title: "Been sitting here",
      href: "/work",
    });
    expect(snapshot.needsAttention[0]?.detail).toContain("2026-10-20");
  });

  it("is empty when the inbox is being kept", async () => {
    await capture("Fresh capture");
    expect((await loadCommand(ZONE, NOW)).needsAttention).toEqual([]);
  });
});
