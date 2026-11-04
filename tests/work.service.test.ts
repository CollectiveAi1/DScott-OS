import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { boards, projects, tasks } from "../src/db/schema";
import {
  captureTask,
  completeTask,
  createProject,
  deleteTask,
  moveTask,
  reopenTask,
  setProjectStatus,
  triageTask,
  updateTask,
} from "../src/modules/work/service";
import { listProjects, taskById } from "../src/modules/work/queries";
import { freshDb } from "./helpers/db";

const TODAY = "2026-11-02";
const COLUMNS = ["To do", "Doing", "Waiting on others", "Done"];

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
  await db.delete(projects);
  await db.delete(boards);
  const [board] = await db.insert(boards).values({ name: "This week", columns: COLUMNS }).returning();
  boardId = board!.id;
});

async function capture(line: string) {
  const result = await captureTask(db, { line, today: TODAY });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("captureTask", () => {
  it("lands in the inbox even when it is tagged", async () => {
    const task = await capture("Call coach re: film session #basketball !high due:tomorrow");
    expect(task).toMatchObject({
      title: "Call coach re: film session",
      arena: "basketball",
      priority: "high",
      due: "2026-11-03",
      fromMisc: true,
      status: "open",
      createdBy: "devon",
    });
  });

  it("records who captured it", async () => {
    const result = await captureTask(db, { line: "From the Operator", today: TODAY, createdBy: "operator" });
    expect(result.ok && result.data.createdBy).toBe("operator");
  });

  it("refuses an empty line with a message for Devon", async () => {
    const result = await captureTask(db, { line: "   ", today: TODAY });
    expect(result).toEqual({ ok: false, error: { code: "empty_capture", message: "Type something to capture." } });
    expect(await db.select().from(tasks)).toHaveLength(0);
  });
});

describe("triageTask", () => {
  it("clears fromMisc and writes every chosen field", async () => {
    const task = await capture("Draft the pilot proposal");
    const result = await triageTask(db, {
      taskId: task.id,
      arena: "collective",
      boardId,
      boardColumn: "Doing",
      due: "2026-11-10",
      priority: "high",
    });

    expect(result.ok).toBe(true);
    expect(await taskById(db, task.id)).toMatchObject({
      fromMisc: false,
      arena: "collective",
      boardId,
      boardColumn: "Doing",
      due: "2026-11-10",
      priority: "high",
    });
  });

  it("refuses a column the board does not have", async () => {
    const task = await capture("Something");
    const result = await triageTask(db, {
      taskId: task.id,
      arena: "misc",
      boardId,
      boardColumn: "Blocked",
      due: null,
      priority: "normal",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "bad_column" } });
    expect((await taskById(db, task.id))?.fromMisc).toBe(true);
  });

  it("drops the column when no board is chosen", async () => {
    const task = await capture("Loose end");
    await triageTask(db, {
      taskId: task.id,
      arena: "misc",
      boardId: null,
      boardColumn: "Doing",
      due: null,
      priority: "normal",
    });
    expect(await taskById(db, task.id)).toMatchObject({ boardId: null, boardColumn: null, fromMisc: false });
  });

  it("reports a capture that is already gone", async () => {
    const result = await triageTask(db, {
      taskId: "00000000-0000-0000-0000-000000000000",
      arena: "misc",
      boardId: null,
      boardColumn: null,
      due: null,
      priority: "normal",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("moveTask", () => {
  it("writes the new column", async () => {
    const task = await capture("Move me");
    await triageTask(db, { taskId: task.id, arena: "misc", boardId, boardColumn: "To do", due: null, priority: "normal" });

    expect((await moveTask(db, task.id, "Waiting on others")).ok).toBe(true);
    expect((await taskById(db, task.id))?.boardColumn).toBe("Waiting on others");
  });

  it("refuses a column that is not on the board", async () => {
    const task = await capture("Move me");
    await triageTask(db, { taskId: task.id, arena: "misc", boardId, boardColumn: "To do", due: null, priority: "normal" });

    expect(await moveTask(db, task.id, "Nowhere")).toMatchObject({ ok: false, error: { code: "bad_column" } });
    expect((await taskById(db, task.id))?.boardColumn).toBe("To do");
  });

  it("refuses a task that is not on a board", async () => {
    const task = await capture("Still in the inbox");
    expect(await moveTask(db, task.id, "To do")).toMatchObject({ ok: false, error: { code: "no_board" } });
  });
});

describe("completeTask", () => {
  it("sets done, stamps completedAt and takes it out of the inbox", async () => {
    const task = await capture("Finish me");
    const now = new Date("2026-11-02T18:00:00Z");
    const result = await completeTask(db, task.id, now);

    expect(result.ok).toBe(true);
    expect(await taskById(db, task.id)).toMatchObject({
      status: "done",
      completedAt: now,
      fromMisc: false,
    });
  });

  it("refuses to complete the same task twice", async () => {
    const task = await capture("Once only");
    expect((await completeTask(db, task.id)).ok).toBe(true);
    expect(await completeTask(db, task.id)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("reopens a completed task and clears the stamp", async () => {
    const task = await capture("Back again");
    await completeTask(db, task.id);
    expect((await reopenTask(db, task.id)).ok).toBe(true);
    expect(await taskById(db, task.id)).toMatchObject({ status: "open", completedAt: null });
  });
});

describe("deleteTask", () => {
  it("removes the row and says so when it is already gone", async () => {
    const task = await capture("Never mind");
    expect((await deleteTask(db, task.id)).ok).toBe(true);
    expect(await taskById(db, task.id)).toBeNull();
    expect(await deleteTask(db, task.id)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("updateTask", () => {
  it("writes every editable field, notes included", async () => {
    const task = await capture("Rough title");
    const project = await createProject(db, { name: "Kinetic pilot", owner: "Devon", due: null, arena: "collective" });
    if (!project.ok) throw new Error("project did not save");

    const result = await updateTask(db, {
      taskId: task.id,
      title: "Sharp title",
      notes: "Two lines\nof detail",
      due: "2026-12-01",
      priority: "urgent",
      owner: "Ahmad",
      arena: "collective",
      boardId,
      boardColumn: "Doing",
      projectId: project.data.id,
      contactId: null,
      dealId: null,
    });

    expect(result.ok).toBe(true);
    expect(await taskById(db, task.id)).toMatchObject({
      title: "Sharp title",
      notes: "Two lines\nof detail",
      due: "2026-12-01",
      priority: "urgent",
      owner: "Ahmad",
      arena: "collective",
      boardColumn: "Doing",
      projectId: project.data.id,
    });
  });

  it("refuses a column that is not on the chosen board", async () => {
    const task = await capture("Careful");
    const result = await updateTask(db, {
      taskId: task.id,
      title: "Careful",
      notes: null,
      due: null,
      priority: "normal",
      owner: "Devon",
      arena: "misc",
      boardId,
      boardColumn: "Elsewhere",
      projectId: null,
      contactId: null,
      dealId: null,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "bad_column" } });
  });
});

describe("projects", () => {
  it("counts done over total, and reads 0/0 with no tasks", async () => {
    const created = await createProject(db, { name: "Civic Sports site", owner: "Devon", due: null, arena: "collective" });
    if (!created.ok) throw new Error("project did not save");
    const projectId = created.data.id;

    let summaries = await listProjects(db);
    expect(summaries[0]).toMatchObject({ name: "Civic Sports site", done: 0, total: 0 });

    const first = await capture("One");
    const second = await capture("Two");
    await db.update(tasks).set({ projectId }).where(eq(tasks.id, first.id));
    await db.update(tasks).set({ projectId }).where(eq(tasks.id, second.id));
    await completeTask(db, first.id);

    summaries = await listProjects(db);
    expect(summaries[0]).toMatchObject({ done: 1, total: 2 });
  });

  it("changes status", async () => {
    const created = await createProject(db, { name: "Paused thing", owner: "Devon", due: null, arena: "collective" });
    if (!created.ok) throw new Error("project did not save");
    expect((await setProjectStatus(db, created.data.id, "paused")).ok).toBe(true);
    expect((await listProjects(db))[0]?.status).toBe("paused");
  });
});
