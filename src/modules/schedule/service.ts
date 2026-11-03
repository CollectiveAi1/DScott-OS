import { and, eq, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarEvents, conflictAcks, tasks } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { startOfDayInstant, zonedTimeToInstant } from "@/lib/zoned";
import { pairKey } from "./conflicts";
import { isReadOnlySource, kindAllowedForArena, type EventArena, type EventKind } from "./kinds";
import type { CalendarEvent } from "./queries";

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

/**
 * What the form collects. Dates are inclusive the way Devon thinks about them — an all-day
 * event "on the 5th through the 7th" — and become an exclusive end on the way into storage.
 */
export type EventInput = {
  title: string;
  arena: EventArena;
  kind: EventKind;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string | null;
  notes: string | null;
};

export type EventInstants = { startsAt: Date; endsAt: Date };

/**
 * Form fields to the pair of instants stored on the row. All-day runs from local midnight to
 * local midnight *after* the last day, matching Google's start.date/end.date so M4's mapping is
 * a copy rather than a conversion.
 */
export function toInstants(input: EventInput, timeZone: string): EventInstants {
  if (input.allDay) {
    return {
      startsAt: startOfDayInstant(input.startDate, timeZone),
      endsAt: startOfDayInstant(addDays(input.endDate, 1), timeZone),
    };
  }
  return {
    startsAt: zonedTimeToInstant(input.startDate, input.startTime, timeZone),
    endsAt: zonedTimeToInstant(input.endDate, input.endTime, timeZone),
  };
}

function validate(input: EventInput, timeZone: string): Result<EventInstants> {
  if (!kindAllowedForArena(input.arena, input.kind)) {
    return fail("bad_kind", "That kind does not belong to that arena.");
  }
  const instants = toInstants(input, timeZone);
  if (instants.endsAt.getTime() <= instants.startsAt.getTime()) {
    return fail("bad_range", "It has to end after it starts.");
  }
  return { ok: true, data: instants };
}

export async function createEvent(
  db: Db,
  input: EventInput,
  timeZone: string,
  options: { fromTaskId?: string | null; createdBy?: "devon" | "operator" | "automation" } = {},
): Promise<Result<CalendarEvent>> {
  const checked = validate(input, timeZone);
  if (!checked.ok) return checked;

  const [row] = await db
    .insert(calendarEvents)
    .values({
      title: input.title,
      arena: input.arena,
      kind: input.kind,
      allDay: input.allDay,
      startsAt: checked.data.startsAt,
      endsAt: checked.data.endsAt,
      location: input.location,
      notes: input.notes,
      source: "manual",
      createdBy: options.createdBy ?? "devon",
    })
    .returning();
  if (!row) return fail("not_saved", "That event did not save. Try again.");

  // Turning a capture into an event is triaging it: the thought has been dealt with.
  if (options.fromTaskId) {
    await db
      .update(tasks)
      .set({ status: "done", completedAt: new Date(), fromMisc: false })
      .where(and(eq(tasks.id, options.fromTaskId), eq(tasks.status, "open")));
  }
  return { ok: true, data: row };
}

/** Acks are keyed to a pair and a moment. Move either event and the conflict is new again. */
async function clearAcksFor(db: Db, eventId: string): Promise<void> {
  await db
    .delete(conflictAcks)
    .where(or(eq(conflictAcks.eventAId, eventId), eq(conflictAcks.eventBId, eventId)));
}

export async function updateEvent(
  db: Db,
  id: string,
  input: EventInput,
  timeZone: string,
): Promise<Result<CalendarEvent>> {
  const [existing] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
  if (!existing) return fail("not_found", "That event is no longer there.");

  // Google and import own their rows. Notes are Devon's; everything else is theirs.
  if (isReadOnlySource(existing.source)) {
    const [row] = await db
      .update(calendarEvents)
      .set({ notes: input.notes })
      .where(eq(calendarEvents.id, id))
      .returning();
    if (!row) return fail("not_saved", "That did not save. Try again.");
    return { ok: true, data: row };
  }

  const checked = validate(input, timeZone);
  if (!checked.ok) return checked;

  const [row] = await db
    .update(calendarEvents)
    .set({
      title: input.title,
      arena: input.arena,
      kind: input.kind,
      allDay: input.allDay,
      startsAt: checked.data.startsAt,
      endsAt: checked.data.endsAt,
      location: input.location,
      notes: input.notes,
    })
    .where(eq(calendarEvents.id, id))
    .returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");

  const moved =
    row.startsAt.getTime() !== existing.startsAt.getTime() || row.endsAt.getTime() !== existing.endsAt.getTime();
  if (moved) await clearAcksFor(db, id);

  return { ok: true, data: row };
}

export async function deleteEvent(db: Db, id: string): Promise<Result<{ id: string }>> {
  const [row] = await db.delete(calendarEvents).where(eq(calendarEvents.id, id)).returning({ id: calendarEvents.id });
  if (!row) return fail("not_found", "That event is no longer there.");
  return { ok: true, data: row };
}

/** One row per pair, in canonical order, so acknowledging twice is harmless. */
export async function acknowledgeConflict(db: Db, aId: string, bId: string): Promise<Result<{ ok: true }>> {
  if (aId === bId) return fail("bad_pair", "That is one event, not a pair.");
  const [first, second] = pairKey(aId, bId);

  const rows = await db
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(or(eq(calendarEvents.id, first), eq(calendarEvents.id, second)));
  if (rows.length !== 2) return fail("not_found", "One of those events is no longer there.");

  await db.insert(conflictAcks).values({ eventAId: first, eventBId: second }).onConflictDoNothing();
  return { ok: true, data: { ok: true } };
}
