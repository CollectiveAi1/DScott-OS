import { z } from "zod";
import { addDays, weekdayOf } from "@/lib/dates";
import { instantToZonedParts, startOfDayInstant } from "@/lib/zoned";
import { protectedConflicts } from "@/modules/schedule/conflicts";
import { freeSlots, DEFAULT_DAY_END, DEFAULT_DAY_START } from "@/modules/schedule/free-slots";
import { kindsForArena } from "@/modules/schedule/kinds";
import { conflictsInRange, eventsInRange, type CalendarEvent } from "@/modules/schedule/queries";
import { createEvent } from "@/modules/schedule/service";
import { fail, ok, type Tool, type ToolContext } from "../registry";

const ARENA = z.enum(["collective", "basketball", "family", "misc"]);
const KIND = z.enum(["practice", "s_and_c", "team_event", "game", "travel", "family", "deadline", "other"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30.");
const TIME = z.string().regex(/^\d{2}:\d{2}$/, "Use a 24-hour time like 19:00.");

const MAX_DAYS = 60;

function eventView(event: CalendarEvent, timeZone: string) {
  const start = instantToZonedParts(event.startsAt, timeZone);
  const end = instantToZonedParts(event.endsAt, timeZone);
  return {
    id: event.id,
    title: event.title,
    arena: event.arena,
    kind: event.kind,
    allDay: event.allDay,
    date: start.date,
    start: event.allDay ? null : start.time,
    end: event.allDay ? null : end.time,
    endDate: end.date,
    location: event.location,
    source: event.source,
    readOnly: event.source !== "manual",
  };
}

/**
 * The local days in a range, or null when there are none or there are too many.
 *
 * Null rather than a truncated list on purpose: answering a 12-month question with 60 days of
 * events, under a heading that says 12 months, is a wrong answer dressed as a complete one. A
 * refusal the model can read and narrow is better.
 */
function daysBetween(from: string, to: string): string[] | null {
  if (to < from) return null;
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (days.length >= MAX_DAYS) return null;
    days.push(day);
  }
  return days.length > 0 ? days : null;
}

async function windowFor(ctx: ToolContext, from: string, to: string) {
  const days = daysBetween(from, to);
  if (!days) return null;
  const last = days[days.length - 1];
  if (!last) return null;
  return {
    days,
    from: startOfDayInstant(from, ctx.timeZone),
    to: startOfDayInstant(addDays(last, 1), ctx.timeZone),
  };
}

export const scheduleRangeTool: Tool<{ from: string; to: string; arena?: string }> = {
  name: "schedule.range",
  description:
    "List calendar events between two dates, inclusive. Covers all four arenas, including events " +
    "synced from Google and imported schedules. At most 60 days.",
  effect: "read",
  input: z.object({ from: DATE, to: DATE, arena: ARENA.optional() }),
  async run(ctx, input) {
    const range = await windowFor(ctx, input.from, input.to);
    if (!range) return fail("bad_range", "Ask for a range of 60 days or fewer, ending after it starts.");

    const events = await eventsInRange(ctx.db, range.from, range.to);
    const filtered = input.arena ? events.filter((event) => event.arena === input.arena) : events;
    return ok({ from: input.from, to: input.to, count: filtered.length, events: filtered.map((event) => eventView(event, ctx.timeZone)) });
  },
};

export const scheduleConflictsTool: Tool<{ from?: string; days?: number }> = {
  name: "schedule.conflicts",
  description:
    "Clashes in a window: pairs of overlapping events, and timed events running into protected " +
    "time. Defaults to the next 14 days from today.",
  effect: "read",
  input: z.object({ from: DATE.optional(), days: z.number().int().min(1).max(60).optional() }),
  async run(ctx, input) {
    const start = input.from ?? ctx.today;
    const range = await windowFor(ctx, start, addDays(start, (input.days ?? 14) - 1));
    if (!range) return fail("bad_range", "That window is empty.");

    const found = await conflictsInRange(ctx.db, range.from, range.to, ctx.protectedTime, ctx.timeZone, range.days);

    return ok({
      count: found.length,
      conflicts: found.map((clash) =>
        clash.kind === "pair"
          ? {
              kind: "pair",
              acknowledged: clash.acknowledged,
              a: eventView(clash.a, ctx.timeZone),
              b: eventView(clash.b, ctx.timeZone),
            }
          : {
              kind: "protected",
              event: eventView(clash.event, ctx.timeZone),
              block: clash.hit.block.label,
              date: clash.hit.date,
            },
      ),
    });
  },
};

export const scheduleFreeSlotsTool: Tool<{
  from?: string;
  days?: number;
  minutes?: number;
  dayStart?: string;
  dayEnd?: string;
}> = {
  name: "schedule.free_slots",
  description:
    "Free time: the gaps left once every event and every protected block is removed. Never " +
    "returns time that overlaps something, and never time already past. Use this before " +
    "suggesting when to put something.",
  effect: "read",
  input: z.object({
    from: DATE.optional(),
    days: z.number().int().min(1).max(14).optional(),
    minutes: z.number().int().min(5).max(480).optional(),
    dayStart: TIME.optional(),
    dayEnd: TIME.optional(),
  }),
  async run(ctx, input) {
    const start = input.from ?? ctx.today;
    const days = daysBetween(start, addDays(start, (input.days ?? 7) - 1));
    const last = days?.[days.length - 1];
    if (!days || !last) return fail("bad_range", "That window is empty.");

    const events = await eventsInRange(
      ctx.db,
      startOfDayInstant(start, ctx.timeZone),
      startOfDayInstant(addDays(last, 1), ctx.timeZone),
    );

    const slots = freeSlots({
      days,
      timeZone: ctx.timeZone,
      events,
      protectedTime: ctx.protectedTime,
      minimumMinutes: input.minutes ?? 30,
      dayStart: input.dayStart ?? DEFAULT_DAY_START,
      dayEnd: input.dayEnd ?? DEFAULT_DAY_END,
      from: ctx.now,
    });

    return ok({
      timeZone: ctx.timeZone,
      count: slots.length,
      slots: slots.map((slot) => ({ date: slot.date, start: slot.start, end: slot.end, minutes: slot.minutes })),
    });
  },
};

export const scheduleCreateEventTool: Tool<{
  title: string;
  arena: "collective" | "basketball" | "family" | "misc";
  kind: string;
  date: string;
  start?: string | null;
  end?: string | null;
  endDate?: string | null;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
}> = {
  name: "schedule.create_event",
  description:
    "Put a manual event on the calendar. Basketball takes practice, s_and_c, team_event, game " +
    "or travel; Collective and Misc take deadline or other; Family takes family, deadline or " +
    "other. Timed events need start and end; all-day events need date and optionally endDate. " +
    "Cannot touch Google or imported events.",
  effect: "write",
  input: z.object({
    title: z.string().min(1).max(300),
    arena: ARENA,
    kind: KIND,
    date: DATE,
    start: TIME.nullish(),
    end: TIME.nullish(),
    endDate: DATE.nullish(),
    allDay: z.boolean().optional(),
    location: z.string().max(300).nullish(),
    notes: z.string().max(2000).nullish(),
  }),
  async run(ctx, input) {
    const allowed = kindsForArena(input.arena).map((option) => option.value);
    if (!allowed.includes(input.kind as (typeof allowed)[number])) {
      return fail("bad_kind", `${input.arena} events are one of: ${allowed.join(", ")}.`);
    }

    const allDay = input.allDay ?? !input.start;
    if (!allDay && (!input.start || !input.end)) {
      return fail("needs_times", "A timed event needs both a start and an end time.");
    }

    const result = await createEvent(
      ctx.db,
      {
        title: input.title,
        arena: input.arena,
        kind: input.kind as (typeof allowed)[number],
        allDay,
        startDate: input.date,
        startTime: input.start ?? "09:00",
        endDate: input.endDate ?? input.date,
        endTime: input.end ?? "10:00",
        location: input.location ?? null,
        notes: input.notes ?? null,
      },
      ctx.timeZone,
      { createdBy: "operator" },
    );
    if (!result.ok) return fail(result.error.code, result.error.message);

    // Say immediately whether it landed on top of something: an event the Operator created that
    // clashes is worth one sentence now, not a surprise in tomorrow's brief.
    const hits = protectedConflicts(
      result.data,
      ctx.protectedTime,
      [{ date: input.date, weekday: weekdayOf(input.date) }],
      ctx.timeZone,
    );

    return ok({
      event: eventView(result.data, ctx.timeZone),
      protectedTimeHit: hits.map((hit) => hit.block.label),
    });
  },
};

export const SCHEDULE_TOOLS = [scheduleRangeTool, scheduleConflictsTool, scheduleFreeSlotsTool, scheduleCreateEventTool];
