import { instantToZonedParts, startOfDayInstant } from "@/lib/zoned";
import { addDays } from "@/lib/dates";

/** The rows the brief reads. Shaped so the function needs no database and no clock. */
export type BriefEvent = {
  id: string;
  title: string;
  arena: string;
  kind: string;
  allDay: boolean;
  startsAt: Date;
  endsAt: Date;
};

export type BriefTask = { id: string; title: string; due: string | null; arena: string; priority: string };

export type BriefDeal = {
  id: string;
  title: string;
  pipeline: string;
  stage: string;
  nextStep: string | null;
  nextStepDue: string | null;
};

export type BriefConflict = { left: string; right: string; when: string };

export type BriefInput = {
  day: string;
  timeZone: string;
  /** Events overlapping today, and conflicts already resolved for the next 72 hours. */
  events: BriefEvent[];
  conflicts: BriefConflict[];
  /** Open tasks with a due date on or before today. */
  tasks: BriefTask[];
  deals: BriefDeal[];
  approvalsWaiting: number;
  miscInbox: number;
  /** Family events overlapping tomorrow, so "tomorrow" needs no second query shape. */
  tomorrowFamily: BriefEvent[];
};

export type BriefItem = { title: string; when: string; arena: string; kind: string };

export type BriefData = {
  day: string;
  /** Today's events, grouped by arena in a fixed order so the brief reads the same way daily. */
  byArena: { arena: string; items: BriefItem[] }[];
  travel: BriefItem[];
  conflicts: BriefConflict[];
  overdue: BriefTask[];
  dueToday: BriefTask[];
  deals: { noNextStep: BriefDeal[]; overdue: BriefDeal[] };
  approvalsWaiting: number;
  miscInbox: number;
  family: { today: BriefItem[]; tomorrow: BriefItem[] };
};

const ARENA_ORDER = ["collective", "basketball", "family", "misc"] as const;

export const ARENA_LABEL: Record<string, string> = {
  collective: "Collective",
  basketball: "Basketball",
  family: "Family",
  misc: "Misc",
};

/**
 * One event as a line: what it is called and when, in local wall time.
 *
 * An all-day event spanning days says so, because "All day" on the third morning of a trip is
 * not what Devon needs to read.
 */
export function itemFor(event: BriefEvent, day: string, timeZone: string): BriefItem {
  const when = event.allDay ? allDayLabel(event, day, timeZone) : timedLabel(event, day, timeZone);
  return { title: event.title, when, arena: event.arena, kind: event.kind };
}

function timedLabel(event: BriefEvent, day: string, timeZone: string): string {
  const start = instantToZonedParts(event.startsAt, timeZone);
  const end = instantToZonedParts(event.endsAt, timeZone);
  const from = start.date === day ? start.time : `${start.date} ${start.time}`;
  const to = end.date === day ? end.time : `${end.date} ${end.time}`;
  return `${from}–${to}`;
}

function allDayLabel(event: BriefEvent, day: string, timeZone: string): string {
  const first = instantToZonedParts(event.startsAt, timeZone).date;
  // All-day ranges end at an exclusive midnight, so the last day it covers is the day before.
  const lastDay = instantToZonedParts(new Date(event.endsAt.getTime() - 1), timeZone).date;
  if (first === lastDay) return "All day";
  if (day === first) return `All day, through ${lastDay}`;
  if (day === lastDay) return `All day, back today`;
  return `All day, ${first} to ${lastDay}`;
}

function startsOn(event: BriefEvent, day: string, timeZone: string): number {
  if (event.allDay) return -1;
  return event.startsAt.getTime() - startOfDayInstant(day, timeZone).getTime();
}

/**
 * The brief, computed. Every number and list here is derived from the rows passed in — nothing
 * is estimated, and nothing is left for prose to work out. The model only ever rephrases this.
 */
export function buildBrief(input: BriefInput): BriefData {
  const { day, timeZone } = input;
  const ordered = [...input.events].sort((a, b) => startsOn(a, day, timeZone) - startsOn(b, day, timeZone));

  const byArena = ARENA_ORDER.map((arena) => ({
    arena,
    items: ordered.filter((event) => event.arena === arena).map((event) => itemFor(event, day, timeZone)),
  })).filter((group) => group.items.length > 0);

  const travel = ordered.filter((event) => event.kind === "travel").map((event) => itemFor(event, day, timeZone));

  const overdue = input.tasks.filter((task) => task.due !== null && task.due < day);
  const dueToday = input.tasks.filter((task) => task.due === day);

  const noNextStep = input.deals.filter((deal) => !deal.nextStep?.trim());
  const dealsOverdue = input.deals.filter(
    (deal) => Boolean(deal.nextStep?.trim()) && deal.nextStepDue !== null && deal.nextStepDue < day,
  );

  return {
    day,
    byArena,
    travel,
    conflicts: input.conflicts,
    overdue,
    dueToday,
    deals: { noNextStep, overdue: dealsOverdue },
    approvalsWaiting: input.approvalsWaiting,
    miscInbox: input.miscInbox,
    family: {
      today: ordered.filter((event) => event.arena === "family").map((event) => itemFor(event, day, timeZone)),
      tomorrow: [...input.tomorrowFamily]
        .sort((a, b) => startsOn(a, addDays(day, 1), timeZone) - startsOn(b, addDays(day, 1), timeZone))
        .map((event) => itemFor(event, addDays(day, 1), timeZone)),
    },
  };
}

/** True when the day has nothing in it at all — the one case worth saying plainly. */
export function briefIsEmpty(data: BriefData): boolean {
  return (
    data.byArena.length === 0 &&
    data.conflicts.length === 0 &&
    data.overdue.length === 0 &&
    data.dueToday.length === 0 &&
    data.deals.noNextStep.length === 0 &&
    data.deals.overdue.length === 0 &&
    data.approvalsWaiting === 0 &&
    data.miscInbox === 0 &&
    data.family.tomorrow.length === 0
  );
}
