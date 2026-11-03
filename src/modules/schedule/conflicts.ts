import type { ProtectedBlock } from "@/db/schema";
import { minutesOfDay } from "@/lib/dates";
import { minutesIntoDay } from "@/lib/zoned";

/** The shape the rule needs. Any row from calendar_events satisfies it. */
export type ConflictEvent = {
  id: string;
  title: string;
  arena: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
};

/**
 * Half-open intervals, [start, end): a 10:00–11:00 meeting and an 11:00–12:00 call do not
 * overlap. Back-to-back scheduling is the normal case, not a conflict.
 */
export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/**
 * Whether two events collide, per SPEC-003 §3 as amended at the M4 gate (SPEC-004 §2).
 *
 * The amendment: when one side is all-day, it only collides if it is Travel. Devon is on a
 * plane; he is not at a birthday all day. Read literally, the original rule made every all-day
 * entry in the synced Family calendar clash with every meeting that day, and a conflict has to
 * mean something or the panel stops being read.
 */
export function eventsConflict(a: ConflictEvent, b: ConflictEvent): boolean {
  if (a.id === b.id) return false;
  // Rule 1: no overlap, no conflict.
  if (!overlaps(a, b)) return false;
  // Rule 2: two all-day events sit alongside each other, they do not collide.
  if (a.allDay && b.allDay) return false;
  // Rule 3: a practice inside a team event is normal. Basketball only — two Collective
  // meetings double-booked is exactly what Devon wants caught.
  if (a.arena === "basketball" && b.arena === "basketball") return false;
  // Rules 4 and 5: an all-day event blocks the day only when it is travel. Everything else
  // all-day — a birthday, a holiday, a deadline — sits behind the day without occupying it.
  const allDaySide = a.allDay ? a : b.allDay ? b : null;
  if (allDaySide) return allDaySide.kind === "travel";
  // Both are timed and they overlap.
  return true;
}

export type ProtectedHit = { block: ProtectedBlock; date: string };

/**
 * Protected time a timed event runs into. A block is a weekly rule rather than a row with
 * instants, so each local day the event touches is checked against the blocks for that weekday.
 *
 * An all-day event never trips protected time: it is not occupying the hours.
 */
export function protectedConflicts(
  event: ConflictEvent,
  blocks: ProtectedBlock[],
  days: { date: string; weekday: number }[],
  timeZone: string,
): ProtectedHit[] {
  if (event.allDay || blocks.length === 0) return [];

  const hits: ProtectedHit[] = [];
  for (const { date, weekday } of days) {
    // Minutes from this day's local midnight. An event starting yesterday gives a negative
    // start, one ending tomorrow a value past 1440; both compare correctly against the block.
    const startMinutes = minutesIntoDay(event.startsAt, date, timeZone);
    const endMinutes = minutesIntoDay(event.endsAt, date, timeZone);
    if (endMinutes <= 0 || startMinutes >= 24 * 60) continue;

    for (const block of blocks) {
      if (!block.days.includes(weekday)) continue;
      if (startMinutes < minutesOfDay(block.end) && minutesOfDay(block.start) < endMinutes) {
        hits.push({ block, date });
      }
    }
  }
  return hits;
}

/** A pair, always smaller id first, so one acknowledgement covers it however it was found. */
export function pairKey(aId: string, bId: string): [string, string] {
  return aId < bId ? [aId, bId] : [bId, aId];
}

export type ConflictPair = { a: ConflictEvent; b: ConflictEvent };

/**
 * Every colliding pair in a set of events. O(n²) over one window of the calendar, which is a
 * few hundred events at most on a single-owner instance.
 */
export function findConflictPairs(events: ConflictEvent[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (a && b && eventsConflict(a, b)) pairs.push({ a, b });
    }
  }
  return pairs;
}
