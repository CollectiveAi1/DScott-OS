import { startOfDayInstant } from "@/lib/zoned";

/** The parts of a Google calendar event this module reads. */
export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurringEventId?: string;
};

export type MappedEvent = {
  externalId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  externalUrl: string | null;
};

export type MapResult =
  | { kind: "event"; event: MappedEvent }
  | { kind: "cancelled"; externalId: string }
  | { kind: "skip"; reason: string };

const NO_TITLE = "(no title)";

export function externalIdFor(calendarId: string, eventId: string): string {
  return `${calendarId}:${eventId}`;
}

/**
 * One Google event into one row, or an instruction to remove it.
 *
 * `description` is deliberately not mapped. `notes` is the single field Devon can edit on a
 * synced row, and a sync that rewrote it every ten minutes would make it useless. The
 * description stays one click away through `externalUrl`.
 *
 * With `singleEvents=true` a recurring event arrives already expanded into instances, each with
 * its own id, so there is nothing special to do here.
 */
export function mapGoogleEvent(raw: GoogleEvent, calendarId: string, timeZone: string): MapResult {
  if (!raw.id) return { kind: "skip", reason: "no id" };
  const externalId = externalIdFor(calendarId, raw.id);
  if (raw.status === "cancelled") return { kind: "cancelled", externalId };

  const allDay = Boolean(raw.start?.date);

  let startsAt: Date;
  let endsAt: Date;
  if (allDay) {
    const startDate = raw.start?.date;
    // Google's end.date is already exclusive, which is exactly how this OS stores all-day
    // events (SPEC-003 §2). A copy, not a conversion.
    const endDate = raw.end?.date;
    if (!startDate || !endDate) return { kind: "skip", reason: "all-day event with no dates" };
    startsAt = startOfDayInstant(startDate, timeZone);
    endsAt = startOfDayInstant(endDate, timeZone);
  } else {
    const startIso = raw.start?.dateTime;
    const endIso = raw.end?.dateTime;
    if (!startIso || !endIso) return { kind: "skip", reason: "timed event with no times" };
    startsAt = new Date(startIso);
    endsAt = new Date(endIso);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return { kind: "skip", reason: "unreadable times" };
    }
  }

  if (endsAt.getTime() <= startsAt.getTime()) return { kind: "skip", reason: "ends before it starts" };

  return {
    kind: "event",
    event: {
      externalId,
      title: raw.summary?.trim() || NO_TITLE,
      startsAt,
      endsAt,
      allDay,
      location: raw.location?.trim() || null,
      externalUrl: raw.htmlLink ?? null,
    },
  };
}
