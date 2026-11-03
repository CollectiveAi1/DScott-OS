import { and, asc, eq, gt, lt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarEvents, conflictAcks, type ProtectedBlock } from "@/db/schema";
import { weekdayOf } from "@/lib/dates";
import { findConflictPairs, pairKey, protectedConflicts, type ConflictEvent, type ProtectedHit } from "./conflicts";

export type CalendarEvent = typeof calendarEvents.$inferSelect;

/**
 * Every event touching a half-open window. An event that starts before the window and ends
 * inside it counts, which is what makes multi-day travel show on each of its days.
 */
export async function eventsInRange(db: Db, from: Date, to: Date): Promise<CalendarEvent[]> {
  return db
    .select()
    .from(calendarEvents)
    .where(and(lt(calendarEvents.startsAt, to), gt(calendarEvents.endsAt, from)))
    .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.title))
    .limit(1000);
}

export async function eventById(db: Db, id: string): Promise<CalendarEvent | null> {
  const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
  return row ?? null;
}

export type Conflict =
  | { kind: "pair"; a: CalendarEvent; b: CalendarEvent; acknowledged: boolean }
  | { kind: "protected"; event: CalendarEvent; hit: ProtectedHit };

/**
 * Conflicts inside a window: colliding pairs with their acknowledgement state, plus any timed
 * event running into protected time. Protected hits carry no ack — there is no second event id
 * to key one on.
 */
export async function conflictsInRange(
  db: Db,
  from: Date,
  to: Date,
  blocks: ProtectedBlock[],
  timeZone: string,
  days: string[],
): Promise<Conflict[]> {
  const events = await eventsInRange(db, from, to);
  if (events.length === 0) return [];

  const byId = new Map(events.map((event) => [event.id, event]));
  const pairs = findConflictPairs(events as ConflictEvent[]);

  const acked = new Set<string>();
  if (pairs.length > 0) {
    const rows = await db
      .select({ a: conflictAcks.eventAId, b: conflictAcks.eventBId })
      .from(conflictAcks)
      .where(
        or(
          ...pairs.map(({ a, b }) => {
            const [first, second] = pairKey(a.id, b.id);
            return and(eq(conflictAcks.eventAId, first), eq(conflictAcks.eventBId, second));
          }),
        ),
      );
    for (const row of rows) acked.add(`${row.a}+${row.b}`);
  }

  const conflicts: Conflict[] = pairs.flatMap(({ a, b }) => {
    const left = byId.get(a.id);
    const right = byId.get(b.id);
    if (!left || !right) return [];
    const [first, second] = pairKey(a.id, b.id);
    return [{ kind: "pair" as const, a: left, b: right, acknowledged: acked.has(`${first}+${second}`) }];
  });

  const window = days.map((date) => ({ date, weekday: weekdayOf(date) }));
  for (const event of events) {
    for (const hit of protectedConflicts(event as ConflictEvent, blocks, window, timeZone)) {
      conflicts.push({ kind: "protected", event, hit });
    }
  }
  return conflicts;
}

/** Event ids involved in at least one unacknowledged conflict, for badging both sides. */
export function conflictedEventIds(conflicts: Conflict[]): Set<string> {
  const ids = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.kind === "protected") ids.add(conflict.event.id);
    else if (!conflict.acknowledged) {
      ids.add(conflict.a.id);
      ids.add(conflict.b.id);
    }
  }
  return ids;
}
