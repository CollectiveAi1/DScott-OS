import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { boards, projects, tasks } from "@/db/schema";
import { parseCapture, type Arena, type Priority } from "./capture";
import type { Task } from "./queries";

/** The Result shape from PRD §6.1. Messages are written for Devon, never for a developer. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

export type Actor = "devon" | "operator" | "automation";

/** Quick capture: one line in, one untriaged task out. */
export async function captureTask(
  db: Db,
  input: { line: string; today: string; createdBy?: Actor },
): Promise<Result<Task>> {
  const parsed = parseCapture(input.line, input.today);
  if (!parsed.ok) return fail("empty_capture", parsed.error);

  const [row] = await db
    .insert(tasks)
    .values({
      title: parsed.capture.title,
      arena: parsed.capture.arena,
      priority: parsed.capture.priority,
      due: parsed.capture.due,
      fromMisc: true,
      createdBy: input.createdBy ?? "devon",
    })
    .returning();
  if (!row) return fail("not_saved", "That capture did not save. Try again.");
  return { ok: true, data: row };
}

async function requireTask(db: Db, id: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row ?? null;
}

/** A column is only valid if the board actually has it. */
async function columnIsOnBoard(db: Db, boardId: string, column: string | null): Promise<boolean> {
  if (column === null) return true;
  const [board] = await db.select({ columns: boards.columns }).from(boards).where(eq(boards.id, boardId)).limit(1);
  return board ? board.columns.includes(column) : false;
}

export type TriageInput = {
  taskId: string;
  arena: Arena;
  boardId: string | null;
  boardColumn: string | null;
  due: string | null;
  priority: Priority;
};

/** Sort a capture out of the inbox and onto the board. */
export async function triageTask(db: Db, input: TriageInput): Promise<Result<Task>> {
  const task = await requireTask(db, input.taskId);
  if (!task) return fail("not_found", "That capture is no longer there.");

  if (input.boardId && !(await columnIsOnBoard(db, input.boardId, input.boardColumn))) {
    return fail("bad_column", "That column is not on that board.");
  }

  const [row] = await db
    .update(tasks)
    .set({
      arena: input.arena,
      boardId: input.boardId,
      boardColumn: input.boardId ? input.boardColumn : null,
      due: input.due,
      priority: input.priority,
      fromMisc: false,
    })
    .where(eq(tasks.id, input.taskId))
    .returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");
  return { ok: true, data: row };
}

export async function moveTask(db: Db, taskId: string, column: string): Promise<Result<Task>> {
  const task = await requireTask(db, taskId);
  if (!task) return fail("not_found", "That task is no longer there.");
  if (!task.boardId) return fail("no_board", "That task is not on a board yet.");
  if (!(await columnIsOnBoard(db, task.boardId, column))) {
    return fail("bad_column", "That column is not on this board.");
  }

  const [row] = await db.update(tasks).set({ boardColumn: column }).where(eq(tasks.id, taskId)).returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");
  return { ok: true, data: row };
}

/** Completing also clears fromMisc: a capture you finish is triaged by finishing it. */
export async function completeTask(db: Db, taskId: string, now = new Date()): Promise<Result<Task>> {
  const [row] = await db
    .update(tasks)
    .set({ status: "done", completedAt: now, fromMisc: false })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, "open")))
    .returning();
  if (!row) return fail("not_found", "That task is already done or no longer there.");
  return { ok: true, data: row };
}

export async function reopenTask(db: Db, taskId: string): Promise<Result<Task>> {
  const [row] = await db
    .update(tasks)
    .set({ status: "open", completedAt: null })
    .where(eq(tasks.id, taskId))
    .returning();
  if (!row) return fail("not_found", "That task is no longer there.");
  return { ok: true, data: row };
}

export async function deleteTask(db: Db, taskId: string): Promise<Result<{ id: string }>> {
  const [row] = await db.delete(tasks).where(eq(tasks.id, taskId)).returning({ id: tasks.id });
  if (!row) return fail("not_found", "That task is no longer there.");
  return { ok: true, data: row };
}

export type TaskEdit = {
  taskId: string;
  title: string;
  notes: string | null;
  due: string | null;
  priority: Priority;
  owner: string;
  arena: Arena;
  boardId: string | null;
  boardColumn: string | null;
  projectId: string | null;
  contactId: string | null;
  dealId: string | null;
};

export async function updateTask(db: Db, input: TaskEdit): Promise<Result<Task>> {
  const task = await requireTask(db, input.taskId);
  if (!task) return fail("not_found", "That task is no longer there.");
  if (input.boardId && !(await columnIsOnBoard(db, input.boardId, input.boardColumn))) {
    return fail("bad_column", "That column is not on that board.");
  }

  const [row] = await db
    .update(tasks)
    .set({
      title: input.title,
      notes: input.notes,
      due: input.due,
      priority: input.priority,
      owner: input.owner,
      arena: input.arena,
      boardId: input.boardId,
      boardColumn: input.boardId ? input.boardColumn : null,
      projectId: input.projectId,
      contactId: input.contactId,
      dealId: input.dealId,
    })
    .where(eq(tasks.id, input.taskId))
    .returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");
  return { ok: true, data: row };
}

export type Project = typeof projects.$inferSelect;

export async function createProject(
  db: Db,
  input: { name: string; owner: string; due: string | null; arena: Arena },
): Promise<Result<Project>> {
  const [row] = await db
    .insert(projects)
    .values({ name: input.name, owner: input.owner, due: input.due, arena: input.arena })
    .returning();
  if (!row) return fail("not_saved", "That project did not save. Try again.");
  return { ok: true, data: row };
}

export async function setProjectStatus(
  db: Db,
  projectId: string,
  status: Project["status"],
): Promise<Result<Project>> {
  const [row] = await db.update(projects).set({ status }).where(eq(projects.id, projectId)).returning();
  if (!row) return fail("not_found", "That project is no longer there.");
  return { ok: true, data: row };
}
