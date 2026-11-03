import { addDays, weekdayOf } from "./dates";

/**
 * Instants and local calendars. Everything in the database is a timestamptz; everything Devon
 * reads is wall-clock time in settings.timezone. This file is the only place that converts
 * between the two, so there is one implementation to get right and one to test.
 */

const PARTS = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = PARTS.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    PARTS.set(timeZone, found);
  }
  return found;
}

export type ZonedParts = { date: string; time: string };

/** The wall-clock date and time an instant shows as in the given zone. */
export function instantToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    time: `${pick("hour")}:${pick("minute")}`,
  };
}

/** The zone's offset from UTC at a given instant, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  // Milliseconds are not in the parts, so compare on whole seconds.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * A wall-clock date and time in a zone, as an instant.
 *
 * Guess the instant as though the wall time were UTC, measure the zone's offset there, apply it,
 * then measure once more in case the correction crossed a DST boundary. Two passes settles every
 * real zone.
 *
 * Two wall times a year are not one-to-one with instants, and this takes a side on both:
 * a time inside the spring-forward gap resolves to the instant the clock jumps to, and a time
 * that happens twice in autumn resolves to the first of the two.
 */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);

  const firstGuess = wallAsUtc - offsetAt(new Date(wallAsUtc), timeZone);
  const corrected = wallAsUtc - offsetAt(new Date(firstGuess), timeZone);
  if (corrected === firstGuess) return new Date(corrected);

  // The two passes disagree: the wall time is either in a gap or repeated. Prefer the earlier
  // instant that still reads back as the requested time; otherwise take the later one, which is
  // where the clock lands after a gap.
  const [earlier, later] = corrected < firstGuess ? [corrected, firstGuess] : [firstGuess, corrected];
  return new Date(instantToZonedParts(new Date(earlier), timeZone).time === time ? earlier : later);
}

/** Local midnight at the start of a calendar date. */
export function startOfDayInstant(date: string, timeZone: string): Date {
  return zonedTimeToInstant(date, "00:00", timeZone);
}

export type Grid = {
  /** Calendar dates in the grid, in order. */
  days: string[];
  /** Local midnight of the first day. */
  from: Date;
  /** Local midnight after the last day: the range is half-open, [from, to). */
  to: Date;
};

function gridOf(days: string[], timeZone: string): Grid {
  const first = days[0] ?? "1970-01-01";
  const last = days[days.length - 1] ?? first;
  return { days, from: startOfDayInstant(first, timeZone), to: startOfDayInstant(addDays(last, 1), timeZone) };
}

export function dayGrid(date: string, timeZone: string): Grid {
  return gridOf([date], timeZone);
}

/** Monday first, matching protected time's days and the rest of the OS. */
export function startOfWeek(date: string): string {
  return addDays(date, -(weekdayOf(date) - 1));
}

export function weekGrid(date: string, timeZone: string): Grid {
  const monday = startOfWeek(date);
  return gridOf(
    Array.from({ length: 7 }, (_, index) => addDays(monday, index)),
    timeZone,
  );
}

export type MonthGrid = Grid & {
  /** The month the grid is showing, as YYYY-MM. */
  month: string;
  weeks: string[][];
  inMonth: (date: string) => boolean;
};

/**
 * Always six weeks, 42 cells, from the Monday on or before the 1st. A fixed height keeps the
 * grid from reflowing as Devon pages through months.
 */
export function monthGrid(date: string, timeZone: string): MonthGrid {
  const month = date.slice(0, 7);
  const start = startOfWeek(`${month}-01`);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  const weeks = Array.from({ length: 6 }, (_, week) => days.slice(week * 7, week * 7 + 7));
  return { ...gridOf(days, timeZone), month, weeks, inMonth: (day: string) => day.startsWith(month) };
}

/** Minutes from local midnight to an instant, for placing it on a day's grid. */
export function minutesIntoDay(instant: Date, date: string, timeZone: string): number {
  return Math.round((instant.getTime() - startOfDayInstant(date, timeZone).getTime()) / 60_000);
}

/** A grid's days with the half-open instant range each one covers. */
export function dayBounds(days: string[], timeZone: string): { date: string; from: Date; to: Date }[] {
  return days.map((date) => ({
    date,
    from: startOfDayInstant(date, timeZone),
    to: startOfDayInstant(addDays(date, 1), timeZone),
  }));
}
