import { and, eq, gt, inArray, like, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarEvents } from "@/db/schema";
import { externalIdFor, mapGoogleEvent, type GoogleEvent } from "./map-event";

/** The slice of Google's API this module needs. The sync takes it as an argument, so the tests
 *  drive it with recorded fixtures and never touch the network. */
export type GoogleApi = {
  listEvents(input: {
    calendarId: string;
    timeMin: string;
    timeMax: string;
    pageToken?: string;
  }): Promise<{ items: GoogleEvent[]; nextPageToken?: string }>;
};

export const WINDOW_BACK_DAYS = 7;
export const WINDOW_FORWARD_DAYS = 120;
const MAX_PAGES = 50;

export type SyncWindow = { timeMin: Date; timeMax: Date };

export function syncWindow(now: Date): SyncWindow {
  return {
    timeMin: new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000),
    timeMax: new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000),
  };
}

export type CalendarSyncResult = {
  calendarId: string;
  written: number;
  removed: number;
  skipped: number;
  error?: string;
};

/**
 * Read one calendar's window and make the local rows match it.
 *
 * The deletion pass only runs after every page has been read. A partial read that deleted would
 * silently empty Devon's calendar, which is the worst thing this module could do — so a failure
 * anywhere in the paging leaves every row exactly where it was.
 */
export async function syncCalendar(
  db: Db,
  api: GoogleApi,
  input: { calendarId: string; timeZone: string; window: SyncWindow },
): Promise<CalendarSyncResult> {
  const { calendarId, timeZone, window } = input;
  const seen = new Set<string>();
  const cancelled = new Set<string>();
  let written = 0;
  let skipped = 0;

  try {
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const page = await api.listEvents({
        calendarId,
        timeMin: window.timeMin.toISOString(),
        timeMax: window.timeMax.toISOString(),
        pageToken,
      });

      for (const raw of page.items ?? []) {
        const mapped = mapGoogleEvent(raw, calendarId, timeZone);
        if (mapped.kind === "skip") {
          skipped++;
          continue;
        }
        if (mapped.kind === "cancelled") {
          cancelled.add(mapped.externalId);
          continue;
        }

        seen.add(mapped.event.externalId);
        // notes is left out on purpose: it is Devon's field on a read-only row, and a sync
        // must never overwrite it.
        await db
          .insert(calendarEvents)
          .values({
            title: mapped.event.title,
            startsAt: mapped.event.startsAt,
            endsAt: mapped.event.endsAt,
            allDay: mapped.event.allDay,
            location: mapped.event.location,
            externalUrl: mapped.event.externalUrl,
            externalId: mapped.event.externalId,
            source: "google",
            arena: "family",
            kind: "family",
            createdBy: "automation",
          })
          .onConflictDoUpdate({
            target: [calendarEvents.source, calendarEvents.externalId],
            set: {
              title: mapped.event.title,
              startsAt: mapped.event.startsAt,
              endsAt: mapped.event.endsAt,
              allDay: mapped.event.allDay,
              location: mapped.event.location,
              externalUrl: mapped.event.externalUrl,
              updatedAt: new Date(),
            },
          });
        written++;
      }

      pageToken = page.nextPageToken;
      pages++;
    } while (pageToken && pages < MAX_PAGES);
  } catch (error) {
    // Nothing is removed: the picture is incomplete.
    return {
      calendarId,
      written,
      removed: 0,
      skipped,
      error: error instanceof Error ? error.message : "Sync failed.",
    };
  }

  const removed = await removeMissing(db, calendarId, window, seen, cancelled);
  return { calendarId, written, removed, skipped };
}

/**
 * Rows this calendar used to have in the window and no longer does. Scoped by the calendar's
 * own id prefix so two calendars never delete each other's events.
 */
async function removeMissing(
  db: Db,
  calendarId: string,
  window: SyncWindow,
  seen: Set<string>,
  cancelled: Set<string>,
): Promise<number> {
  const existing = await db
    .select({ id: calendarEvents.id, externalId: calendarEvents.externalId })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.source, "google"),
        like(calendarEvents.externalId, `${calendarId}:%`),
        lt(calendarEvents.startsAt, window.timeMax),
        gt(calendarEvents.endsAt, window.timeMin),
      ),
    );

  const stale = existing
    .filter((row) => row.externalId && (cancelled.has(row.externalId) || !seen.has(row.externalId)))
    .map((row) => row.id);
  if (stale.length === 0) return 0;

  await db.delete(calendarEvents).where(inArray(calendarEvents.id, stale));
  return stale.length;
}

/** Everything a calendar holds locally, for Disconnect. */
export async function removeCalendarEvents(db: Db, calendarId: string): Promise<number> {
  const rows = await db
    .delete(calendarEvents)
    .where(and(eq(calendarEvents.source, "google"), like(calendarEvents.externalId, `${calendarId}:%`)))
    .returning({ id: calendarEvents.id });
  return rows.length;
}

export { externalIdFor };
