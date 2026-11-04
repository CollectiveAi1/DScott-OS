import type { ProtectedBlock } from "@/db/schema";
import { weekdayOf } from "@/lib/dates";
import { instantToZonedParts, zonedTimeToInstant } from "@/lib/zoned";

/** The only part of an event this needs: when it runs, and whether it occupies hours at all. */
export type BusyEvent = { startsAt: Date; endsAt: Date; allDay: boolean };

export type FreeSlotsInput = {
  /** Local dates to search, in order. */
  days: string[];
  timeZone: string;
  events: BusyEvent[];
  protectedTime: ProtectedBlock[];
  /** A slot shorter than this is not worth offering. */
  minimumMinutes?: number;
  /** Working-hours bound, local wall clock. Without it the answer is "04:00 is free". */
  dayStart?: string;
  dayEnd?: string;
  /** Time already gone. A free slot in the past is not free, it is over. */
  from?: Date;
  maxPerDay?: number;
};

export type FreeSlot = {
  date: string;
  /** Local wall clock, read back from the instant — so it is always a time that exists. */
  start: string;
  end: string;
  minutes: number;
  startsAt: Date;
  endsAt: Date;
};

type Interval = { from: number; to: number };

export const DEFAULT_DAY_START = "08:00";
export const DEFAULT_DAY_END = "20:00";
export const DEFAULT_MINIMUM_MINUTES = 30;
const DEFAULT_MAX_PER_DAY = 4;

/** Merge overlapping and touching intervals into the smallest set that covers the same time. */
function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.from <= last.to) {
      if (interval.to > last.to) last.to = interval.to;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Free time inside a window, as the gaps left once everything busy is removed.
 *
 * **Everything here is instant arithmetic, never minutes-into-a-day.** Boundaries are converted
 * through `zonedTimeToInstant` and labels read back with `instantToZonedParts`, so a day that is
 * 23 or 25 hours long needs no special case and a returned time is always a wall time that
 * actually exists. This function is pure: the same arguments give the same slots, which is what
 * lets it be trusted before anything calls it.
 *
 * Busy means: any timed event, any all-day event (which takes the whole day — an all-day event
 * is not a hint that the hours are free), and any protected block for that weekday.
 */
export function freeSlots(input: FreeSlotsInput): FreeSlot[] {
  const {
    days,
    timeZone,
    events,
    protectedTime,
    minimumMinutes = DEFAULT_MINIMUM_MINUTES,
    dayStart = DEFAULT_DAY_START,
    dayEnd = DEFAULT_DAY_END,
    from,
    maxPerDay = DEFAULT_MAX_PER_DAY,
  } = input;

  if (minimumMinutes <= 0) return [];

  const slots: FreeSlot[] = [];
  const floor = from?.getTime() ?? Number.NEGATIVE_INFINITY;

  for (const date of days) {
    const windowStart = Math.max(zonedTimeToInstant(date, dayStart, timeZone).getTime(), floor);
    const windowEnd = zonedTimeToInstant(date, dayEnd, timeZone).getTime();
    if (windowEnd - windowStart < minimumMinutes * 60_000) continue;

    const busy: Interval[] = [];

    for (const event of events) {
      const eventFrom = event.startsAt.getTime();
      const eventTo = event.endsAt.getTime();
      // Half-open [start, end): an event ending at 10:00 leaves 10:00 free, as it should.
      if (eventTo <= windowStart || eventFrom >= windowEnd) continue;
      busy.push({ from: Math.max(eventFrom, windowStart), to: Math.min(eventTo, windowEnd) });
    }

    const weekday = weekdayOf(date);
    for (const block of protectedTime) {
      if (!block.days.includes(weekday)) continue;
      const blockFrom = zonedTimeToInstant(date, block.start, timeZone).getTime();
      const blockTo = zonedTimeToInstant(date, block.end, timeZone).getTime();
      if (blockTo <= windowStart || blockFrom >= windowEnd) continue;
      busy.push({ from: Math.max(blockFrom, windowStart), to: Math.min(blockTo, windowEnd) });
    }

    let cursor = windowStart;
    const found: FreeSlot[] = [];
    for (const interval of merge(busy)) {
      if (interval.from - cursor >= minimumMinutes * 60_000) {
        found.push(slot(date, cursor, interval.from, timeZone));
      }
      cursor = Math.max(cursor, interval.to);
    }
    if (windowEnd - cursor >= minimumMinutes * 60_000) {
      found.push(slot(date, cursor, windowEnd, timeZone));
    }

    slots.push(...found.slice(0, maxPerDay));
  }

  return slots;
}

function slot(date: string, from: number, to: number, timeZone: string): FreeSlot {
  const startsAt = new Date(from);
  const endsAt = new Date(to);
  return {
    date,
    start: instantToZonedParts(startsAt, timeZone).time,
    end: instantToZonedParts(endsAt, timeZone).time,
    minutes: Math.round((to - from) / 60_000),
    startsAt,
    endsAt,
  };
}
