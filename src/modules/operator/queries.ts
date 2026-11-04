import { and, asc, count, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, calendarEvents, operatorMessages, operatorThreads, tasks } from "@/db/schema";
import { instantToZonedParts } from "@/lib/zoned";
import type { TodaySnapshot } from "./prompt";

export type Thread = typeof operatorThreads.$inferSelect;
export type Message = typeof operatorMessages.$inferSelect;

/** How much of a thread goes back to the model each turn (PRD §6.3). */
export const CONTEXT_MESSAGES = 30;

export async function listThreads(db: Db, limit = 30): Promise<Thread[]> {
  return db.select().from(operatorThreads).orderBy(desc(operatorThreads.updatedAt)).limit(limit);
}

export async function threadById(db: Db, id: string): Promise<Thread | null> {
  const [row] = await db.select().from(operatorThreads).where(eq(operatorThreads.id, id)).limit(1);
  return row ?? null;
}

/** One thread in order, oldest first — the way it is read and the way it is replayed. */
export async function threadMessages(db: Db, threadId: string, limit = 200): Promise<Message[]> {
  const rows = await db
    .select()
    .from(operatorMessages)
    .where(eq(operatorMessages.threadId, threadId))
    .orderBy(desc(operatorMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

/**
 * The compact "today" every turn gets for free: the date, the zone, the next day of calendar,
 * and the two counts that most often decide what Devon asks next.
 */
export async function todaySnapshot(db: Db, today: string, timeZone: string, now: Date): Promise<TodaySnapshot> {
  const tomorrow = new Date(now.getTime() + 24 * 3_600_000);

  const [events, overdue, waiting] = await Promise.all([
    db
      .select({
        title: calendarEvents.title,
        startsAt: calendarEvents.startsAt,
        allDay: calendarEvents.allDay,
        arena: calendarEvents.arena,
      })
      .from(calendarEvents)
      .where(and(gte(calendarEvents.endsAt, now), lte(calendarEvents.startsAt, tomorrow)))
      .orderBy(asc(calendarEvents.startsAt))
      .limit(12),
    db
      .select({ n: count() })
      .from(tasks)
      .where(and(eq(tasks.status, "open"), isNotNull(tasks.due), sql`${tasks.due} < ${today}`)),
    db.select({ n: count() }).from(approvals).where(eq(approvals.status, "waiting")),
  ]);

  return {
    today,
    timeZone,
    nextDay: events.map((event) => {
      const parts = instantToZonedParts(event.startsAt, timeZone);
      return {
        title: event.title,
        when: event.allDay ? `${parts.date} all day · ${event.arena}` : `${parts.date} ${parts.time} · ${event.arena}`,
      };
    }),
    overdue: overdue[0]?.n ?? 0,
    approvalsWaiting: waiting[0]?.n ?? 0,
  };
}

/** Input and output tokens over a rolling window, for the Settings cost panel. */
export async function tokenUsage(db: Db, since: Date): Promise<{ input: number; output: number; turns: number }> {
  const rows = await db
    .select({ content: operatorMessages.content })
    .from(operatorMessages)
    .where(and(eq(operatorMessages.role, "assistant"), gte(operatorMessages.createdAt, since)))
    .limit(5000);

  let input = 0;
  let output = 0;
  for (const row of rows) {
    const usage = (row.content as { usage?: { input?: number; output?: number } }).usage;
    input += usage?.input ?? 0;
    output += usage?.output ?? 0;
  }
  return { input, output, turns: rows.length };
}
