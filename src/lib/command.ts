import "server-only";
import { and, asc, count, eq, gte, inArray, isNotNull, lt, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, calendarEvents, tasks, timeline } from "@/db/schema";
import { addDays, dateInZone } from "./dates";

export type CommandSnapshot = {
  today: string;
  waitingApprovals: number;
  dueThisWeek: number;
  overdue: number;
  dealsMoved7d: number;
  nextGameOrTravel: { title: string; kind: string; startsAt: Date } | null;
  dueList: { id: string; title: string; due: string | null; arena: string; priority: string }[];
};

export async function loadCommand(timeZone: string, now = new Date()): Promise<CommandSnapshot> {
  const db = getDb();
  const today = dateInZone(now, timeZone);
  const weekEnd = addDays(today, 7);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const openWithDue = and(eq(tasks.status, "open"), isNotNull(tasks.due));

  const [waiting, dueWeek, overdueRows, moved, nextEvent, dueList] = await Promise.all([
    db.select({ n: count() }).from(approvals).where(eq(approvals.status, "waiting")),
    db.select({ n: count() }).from(tasks).where(and(openWithDue, gte(tasks.due, today), lte(tasks.due, weekEnd))),
    db.select({ n: count() }).from(tasks).where(and(openWithDue, lt(tasks.due, today))),
    db
      .select({ n: count() })
      .from(timeline)
      .where(and(eq(timeline.kind, "stage_move"), gte(timeline.createdAt, sevenDaysAgo))),
    db
      .select({ title: calendarEvents.title, kind: calendarEvents.kind, startsAt: calendarEvents.startsAt })
      .from(calendarEvents)
      .where(and(inArray(calendarEvents.kind, ["game", "travel"]), gte(calendarEvents.endsAt, now)))
      .orderBy(asc(calendarEvents.startsAt))
      .limit(1),
    db
      .select({ id: tasks.id, title: tasks.title, due: tasks.due, arena: tasks.arena, priority: tasks.priority })
      .from(tasks)
      .where(and(openWithDue, lte(tasks.due, weekEnd)))
      .orderBy(asc(tasks.due))
      .limit(12),
  ]);

  return {
    today,
    waitingApprovals: waiting[0]?.n ?? 0,
    dueThisWeek: dueWeek[0]?.n ?? 0,
    overdue: overdueRows[0]?.n ?? 0,
    dealsMoved7d: moved[0]?.n ?? 0,
    nextGameOrTravel: nextEvent[0] ?? null,
    dueList,
  };
}
