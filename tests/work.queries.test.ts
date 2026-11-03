import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { boards, tasks } from "../src/db/schema";
import { parseFilters, type WorkFilters } from "../src/modules/work/filters";
import { boardTasks, groupByColumn, listTasks, miscInbox, staleCaptures } from "../src/modules/work/queries";
import { freshDb } from "./helpers/db";

const TODAY = "2026-11-02";
const NOW = new Date("2026-11-02T15:00:00Z");
const COLUMNS = ["To do", "Doing", "Done"];

let db: Db;
let close: () => Promise<void>;
let boardId: string;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(boards);
  const [board] = await db.insert(boards).values({ name: "This week", columns: COLUMNS }).returning();
  boardId = board!.id;
});

function filters(overrides: Partial<WorkFilters> = {}): WorkFilters {
  return { ...parseFilters({}), ...overrides };
}

async function addTask(values: Partial<typeof tasks.$inferInsert> & { title: string }) {
  const [row] = await db.insert(tasks).values({ fromMisc: false, ...values }).returning();
  return row!;
}

describe("miscInbox", () => {
  it("returns untriaged open captures, oldest first", async () => {
    const older = await addTask({ title: "Older capture", fromMisc: true });
    const newer = await addTask({ title: "Newer capture", fromMisc: true });
    // createdAt defaults to now for both; order them explicitly.
    await db.update(tasks).set({ createdAt: new Date("2026-10-30T09:00:00Z") }).where(eq(tasks.id, older.id));
    await db.update(tasks).set({ createdAt: new Date("2026-11-01T09:00:00Z") }).where(eq(tasks.id, newer.id));

    await addTask({ title: "Already triaged" });
    await addTask({ title: "Captured but done", fromMisc: true, status: "done" });

    expect((await miscInbox(db)).map((task) => task.title)).toEqual(["Older capture", "Newer capture"]);
  });
});

describe("listTasks · filters", () => {
  beforeEach(async () => {
    await addTask({ title: "Overdue collective", arena: "collective", due: "2026-10-28", priority: "high" });
    await addTask({ title: "Due today basketball", arena: "basketball", due: TODAY, priority: "urgent" });
    await addTask({ title: "This week family", arena: "family", due: "2026-11-06", priority: "normal" });
    await addTask({ title: "Far off collective", arena: "collective", due: "2026-12-20", priority: "low" });
    await addTask({ title: "No date collective", arena: "collective", priority: "high" });
    await addTask({ title: "Done collective", arena: "collective", due: TODAY, status: "done" });
    await addTask({ title: "Still a capture", fromMisc: true });
  });

  const titles = async (f: WorkFilters) => (await listTasks(db, f, TODAY)).map((task) => task.title);

  it("never shows untriaged captures: the inbox owns those", async () => {
    expect(await titles(filters({ status: "any" }))).not.toContain("Still a capture");
  });

  it("shows open tasks by default and done only when asked", async () => {
    expect(await titles(filters())).not.toContain("Done collective");
    expect(await titles(filters({ status: "done" }))).toEqual(["Done collective"]);
    expect(await titles(filters({ status: "any" }))).toContain("Done collective");
  });

  it("filters by arena", async () => {
    expect(await titles(filters({ arena: "family" }))).toEqual(["This week family"]);
  });

  it("filters by priority", async () => {
    expect(await titles(filters({ priority: "high" }))).toEqual(["Overdue collective", "No date collective"]);
  });

  it("filters by each due window", async () => {
    expect(await titles(filters({ due: "overdue" }))).toEqual(["Overdue collective"]);
    expect(await titles(filters({ due: "today" }))).toEqual(["Due today basketball"]);
    expect(await titles(filters({ due: "week" }))).toEqual(["Due today basketball", "This week family"]);
    expect(await titles(filters({ due: "none" }))).toEqual(["No date collective"]);
  });

  it("never counts an undated task as overdue or due", async () => {
    for (const due of ["overdue", "today", "week"] as const) {
      expect(await titles(filters({ due }))).not.toContain("No date collective");
    }
  });

  it("composes arena, priority, due and status together", async () => {
    expect(await titles(filters({ arena: "collective", priority: "high", due: "overdue", status: "open" }))).toEqual([
      "Overdue collective",
    ]);
    expect(await titles(filters({ arena: "collective", priority: "high", due: "today" }))).toEqual([]);
  });

  it("orders by due date with undated last", async () => {
    const ordered = await titles(filters());
    expect(ordered.indexOf("Overdue collective")).toBeLessThan(ordered.indexOf("Due today basketball"));
    expect(ordered.at(-1)).toBe("No date collective");
  });
});

describe("boardTasks and groupByColumn", () => {
  it("groups into the board's columns and puts strays under Unsorted first", async () => {
    const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
    await addTask({ title: "In To do", boardId, boardColumn: "To do" });
    await addTask({ title: "In Doing", boardId, boardColumn: "Doing" });
    await addTask({ title: "No column", boardId });
    await addTask({ title: "Column no longer on the board", boardId, boardColumn: "Archive" });
    await addTask({ title: "Not on this board" });

    const groups = groupByColumn(board!, await boardTasks(db, boardId, filters(), TODAY));

    expect(groups[0]).toMatchObject({ column: "Unsorted", known: false });
    expect(groups[0]?.tasks.map((task) => task.title).sort()).toEqual([
      "Column no longer on the board",
      "No column",
    ]);
    expect(groups.slice(1).map((group) => group.column)).toEqual(COLUMNS);
    expect(groups[1]?.tasks.map((task) => task.title)).toEqual(["In To do"]);
    expect(groups.flatMap((group) => group.tasks).map((task) => task.title)).not.toContain("Not on this board");
  });

  it("keeps every column, empty ones included, and skips Unsorted when nothing is stray", async () => {
    const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
    await addTask({ title: "Only one", boardId, boardColumn: "To do" });

    const groups = groupByColumn(board!, await boardTasks(db, boardId, filters(), TODAY));
    expect(groups.map((group) => group.column)).toEqual(COLUMNS);
    expect(groups[1]?.tasks).toEqual([]);
  });
});

describe("staleCaptures", () => {
  it("picks up a capture older than seven days and leaves a six-day-old one alone", async () => {
    const stale = await addTask({ title: "Sat too long", fromMisc: true });
    const recent = await addTask({ title: "Captured Friday", fromMisc: true });
    const triaged = await addTask({ title: "Sorted long ago" });

    await db
      .update(tasks)
      .set({ createdAt: new Date("2026-10-20T09:00:00Z") })
      .where(eq(tasks.id, stale.id));
    await db
      .update(tasks)
      .set({ createdAt: new Date("2026-10-27T09:00:00Z") })
      .where(eq(tasks.id, recent.id));
    await db
      .update(tasks)
      .set({ createdAt: new Date("2026-01-01T09:00:00Z") })
      .where(eq(tasks.id, triaged.id));

    expect((await staleCaptures(db, NOW)).map((task) => task.title)).toEqual(["Sat too long"]);
  });

  it("ignores a capture that was completed", async () => {
    const done = await addTask({ title: "Old but finished", fromMisc: true, status: "done" });
    await db.update(tasks).set({ createdAt: new Date("2026-09-01T09:00:00Z") }).where(eq(tasks.id, done.id));
    expect(await staleCaptures(db, NOW)).toHaveLength(0);
  });
});
