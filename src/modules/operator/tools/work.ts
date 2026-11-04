import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { tasks } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { captureTask, completeTask, triageTask } from "@/modules/work/service";
import { listBoards } from "@/modules/work/queries";
import { fail, ok, type Tool } from "../registry";

const ARENA = z.enum(["collective", "basketball", "family", "misc"]);
const PRIORITY = z.enum(["low", "normal", "high", "urgent"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30.");

/** What the model gets back about a task: enough to talk about it, nothing it cannot use. */
function taskView(row: typeof tasks.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    arena: row.arena,
    priority: row.priority,
    status: row.status,
    due: row.due,
    untriaged: row.fromMisc,
    notes: row.notes,
  };
}

export const captureTool: Tool<{ line: string }> = {
  name: "capture",
  description:
    "Capture a one-line task into the Misc inbox, untriaged. Supports the same inline tokens as " +
    "quick capture: #collective #basketball #family #misc set the arena, !high !urgent set the " +
    "priority, and due:YYYY-MM-DD, due:today, due:tomorrow or due:mon…sun set the due date. Use " +
    "this when something just needs writing down, not filing.",
  effect: "write",
  input: z.object({ line: z.string().min(1).max(500) }),
  async run(ctx, input) {
    const result = await captureTask(ctx.db, { line: input.line, today: ctx.today, createdBy: "operator" });
    if (!result.ok) return fail(result.error.code, result.error.message);
    return ok(taskView(result.data));
  },
};

export const tasksSearchTool: Tool<{
  arena?: "collective" | "basketball" | "family" | "misc";
  status?: "open" | "done";
  due?: "overdue" | "today" | "this_week" | "none" | "any";
  text?: string;
  limit?: number;
}> = {
  name: "tasks.search",
  description:
    "Find tasks. Filter by arena, status, a due window (overdue, today, this_week, none, any) " +
    "or matching text. Untriaged captures are included and flagged.",
  effect: "read",
  input: z.object({
    arena: ARENA.optional(),
    status: z.enum(["open", "done"]).optional(),
    due: z.enum(["overdue", "today", "this_week", "none", "any"]).optional(),
    text: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async run(ctx, input) {
    const conditions = [];
    if (input.arena) conditions.push(eq(tasks.arena, input.arena));
    conditions.push(eq(tasks.status, input.status ?? "open"));

    const window = input.due ?? "any";
    if (window === "none") conditions.push(isNull(tasks.due));
    if (window === "overdue") conditions.push(and(isNotNull(tasks.due), lte(tasks.due, addDays(ctx.today, -1))));
    if (window === "today") conditions.push(eq(tasks.due, ctx.today));
    if (window === "this_week") {
      conditions.push(and(isNotNull(tasks.due), gte(tasks.due, ctx.today), lte(tasks.due, addDays(ctx.today, 7))));
    }
    if (input.text?.trim()) {
      conditions.push(sql`lower(${tasks.title}) like ${`%${input.text.trim().toLowerCase()}%`}`);
    }

    const rows = await ctx.db
      .select()
      .from(tasks)
      .where(and(...conditions.filter((condition) => condition !== undefined)))
      .orderBy(sql`${tasks.due} asc nulls last`, desc(tasks.priority), asc(tasks.createdAt))
      .limit(input.limit ?? 20);

    return ok({ count: rows.length, tasks: rows.map(taskView) });
  },
};

export const tasksCreateTool: Tool<{
  title: string;
  arena: "collective" | "basketball" | "family" | "misc";
  due?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  board?: string | null;
  column?: string | null;
}> = {
  name: "tasks.create",
  description:
    "Create a task already filed: an arena, and optionally a board, a column on that board, a " +
    "due date and a priority. Use capture instead when the filing is not known yet.",
  effect: "write",
  input: z.object({
    title: z.string().min(1).max(300),
    arena: ARENA,
    due: DATE.nullish(),
    priority: PRIORITY.optional(),
    board: z.string().max(100).nullish().describe("Board name, as shown in Work."),
    column: z.string().max(100).nullish(),
  }),
  async run(ctx, input) {
    // Resolve the board by name before writing anything: a bad column should be an answer, not
    // a capture left stranded in the inbox.
    let boardId: string | null = null;
    if (input.board?.trim()) {
      const wanted = input.board.trim().toLowerCase();
      const boards = await listBoards(ctx.db);
      const board = boards.find((candidate) => candidate.name.toLowerCase() === wanted);
      if (!board) {
        return fail("no_board", `There is no board called "${input.board}". Boards: ${boards.map((b) => b.name).join(", ")}.`);
      }
      if (input.column && !board.columns.includes(input.column)) {
        return fail("bad_column", `"${input.column}" is not a column on ${board.name}. Columns: ${board.columns.join(", ")}.`);
      }
      boardId = board.id;
    }

    const created = await captureTask(ctx.db, { line: input.title, today: ctx.today, createdBy: "operator" });
    if (!created.ok) return fail(created.error.code, created.error.message);

    const filed = await triageTask(ctx.db, {
      taskId: created.data.id,
      arena: input.arena,
      boardId,
      boardColumn: boardId ? (input.column ?? null) : null,
      due: input.due ?? created.data.due,
      priority: input.priority ?? created.data.priority,
    });
    if (!filed.ok) return fail(filed.error.code, filed.error.message);
    return ok(taskView(filed.data));
  },
};

export const tasksCompleteTool: Tool<{ id: string }> = {
  name: "tasks.complete",
  description: "Mark one task done, by id. Find the id with tasks.search first.",
  effect: "write",
  input: z.object({ id: z.string().uuid() }),
  async run(ctx, input) {
    const result = await completeTask(ctx.db, input.id, ctx.now);
    if (!result.ok) return fail(result.error.code, result.error.message);
    return ok(taskView(result.data));
  },
};

export const WORK_TOOLS = [captureTool, tasksSearchTool, tasksCreateTool, tasksCompleteTool];
