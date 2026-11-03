import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { boards, projects, tasks } from "@/db/schema";
import { dueBounds, type WorkFilters } from "./filters";

export type Task = typeof tasks.$inferSelect;
export type Board = typeof boards.$inferSelect;

/** Untriaged captures, oldest first: the queue Devon is trying to empty. */
export async function miscInbox(db: Db, limit = 50): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.fromMisc, true), eq(tasks.status, "open")))
    .orderBy(asc(tasks.createdAt))
    .limit(limit);
}

/**
 * Declared order, not alphabetical: Work opens on the first board, and that should be the daily
 * one ("This week"), not whichever name happens to sort first.
 */
export async function listBoards(db: Db): Promise<Board[]> {
  return db.select().from(boards).orderBy(asc(boards.position), asc(boards.name));
}

/** Every filter the Work screen offers, as one WHERE. Triaged tasks only: the inbox is separate. */
function filterConditions(filters: WorkFilters, today: string): SQL[] {
  const conditions: SQL[] = [eq(tasks.fromMisc, false)];

  if (filters.arena !== "any") conditions.push(eq(tasks.arena, filters.arena));
  if (filters.priority !== "any") conditions.push(eq(tasks.priority, filters.priority));
  if (filters.status !== "any") conditions.push(eq(tasks.status, filters.status));

  const bounds = dueBounds(filters.due, today);
  if (bounds.kind === "none") {
    conditions.push(isNull(tasks.due));
  } else if (bounds.kind === "range") {
    // An undated task is never overdue, due today, or due this week.
    conditions.push(sql`${tasks.due} is not null`);
    if (bounds.from) conditions.push(gte(tasks.due, bounds.from));
    if (bounds.to) conditions.push(lte(tasks.due, bounds.to));
  }
  return conditions;
}

/** List view: everything matching, soonest due first, undated last. */
export async function listTasks(db: Db, filters: WorkFilters, today: string, limit = 200): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(...filterConditions(filters, today)))
    .orderBy(sql`${tasks.due} asc nulls last`, desc(tasks.priority), asc(tasks.createdAt))
    .limit(limit);
}

/** Board view: the same filters, narrowed to one board. */
export async function boardTasks(db: Db, boardId: string, filters: WorkFilters, today: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.boardId, boardId), ...filterConditions(filters, today)))
    .orderBy(sql`${tasks.due} asc nulls last`, asc(tasks.createdAt))
    .limit(500);
}

export type BoardGroup = { column: string; tasks: Task[]; known: boolean };

/**
 * Tasks grouped into the board's columns. A task whose column is missing or no longer on the
 * board is collected under Unsorted and shown first: nothing a board holds is invisible.
 */
export function groupByColumn(board: Board, rows: Task[]): BoardGroup[] {
  const known = new Map<string, Task[]>(board.columns.map((column) => [column, []]));
  const unsorted: Task[] = [];

  for (const task of rows) {
    const bucket = task.boardColumn ? known.get(task.boardColumn) : undefined;
    if (bucket) bucket.push(task);
    else unsorted.push(task);
  }

  const groups: BoardGroup[] = board.columns.map((column) => ({
    column,
    tasks: known.get(column) ?? [],
    known: true,
  }));
  return unsorted.length > 0 ? [{ column: "Unsorted", tasks: unsorted, known: false }, ...groups] : groups;
}

export async function taskById(db: Db, id: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row ?? null;
}

export type ProjectSummary = typeof projects.$inferSelect & { done: number; total: number };

/** Projects with their task counts. Two queries, not one per project. */
export async function listProjects(db: Db): Promise<ProjectSummary[]> {
  const rows = await db.select().from(projects).orderBy(asc(projects.name));
  if (rows.length === 0) return [];

  const counts = await db
    .select({
      projectId: tasks.projectId,
      total: count(),
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')`.mapWith(Number),
    })
    .from(tasks)
    .where(
      inArray(
        tasks.projectId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(tasks.projectId);

  const byProject = new Map(counts.map((row) => [row.projectId, row]));
  return rows.map((row) => {
    const tally = byProject.get(row.id);
    return { ...row, done: tally?.done ?? 0, total: tally?.total ?? 0 };
  });
}

export async function projectOptions(db: Db): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(or(eq(projects.status, "active"), eq(projects.status, "paused")))
    .orderBy(asc(projects.name));
}

/** Captures that have sat untriaged longer than a week. PRD §11 wants this at zero. */
export async function staleCaptures(db: Db, now: Date, days = 7): Promise<Task[]> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.fromMisc, true), eq(tasks.status, "open"), lt(tasks.createdAt, cutoff)))
    .orderBy(asc(tasks.createdAt))
    .limit(20);
}
