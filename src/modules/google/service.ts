import "server-only";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { calendarEvents, settings, type CalendarSource } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { listCalendars, listEvents, revokeToken, type GoogleCalendar } from "./api";
import { removeCalendarEvents, syncCalendar, syncWindow, type GoogleApi } from "./sync";
import { forgetConnection, readConnection, withAccessToken } from "./tokens";

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

const RECONNECT = "Google has disconnected. Reconnect in Settings.";

export async function availableCalendars(): Promise<Result<GoogleCalendar[]>> {
  const calendars = await withAccessToken((token) => listCalendars(token));
  if (!calendars) return fail("disconnected", RECONNECT);
  return { ok: true, data: calendars };
}

async function writeSources(sources: CalendarSource[]): Promise<void> {
  await getDb().update(settings).set({ calendarSources: sources }).where(eq(settings.id, 1));
}

/** Which calendars feed Family. Picking a calendar keeps whatever sync history it already had. */
export async function setPickedCalendars(picked: { calendarId: string; summary: string }[]): Promise<Result<number>> {
  const current = await getSettings();
  const existing = new Map(current.calendarSources.map((source) => [source.calendarId, source]));

  const sources: CalendarSource[] = picked.map((calendar) => ({
    // Keep whatever sync history this calendar already had...
    ...existing.get(calendar.calendarId),
    provider: "google",
    calendarId: calendar.calendarId,
    arena: "family",
    // ...but take the name as Google has it now; it can be renamed there.
    summary: calendar.summary,
  }));

  // A calendar that was unticked takes its synced events with it.
  const dropped = current.calendarSources.filter(
    (source) => !picked.some((calendar) => calendar.calendarId === source.calendarId),
  );
  for (const source of dropped) await removeCalendarEvents(getDb(), source.calendarId);

  await writeSources(sources);
  return { ok: true, data: sources.length };
}

export type SyncSummary = { calendars: number; written: number; removed: number; errors: string[] };

/**
 * Sync every picked calendar. One calendar's failure is recorded on that source and does not
 * stop the others, and a disconnected account stops the run rather than retrying per calendar.
 */
export async function syncAllCalendars(now = new Date()): Promise<Result<SyncSummary>> {
  const current = await getSettings();
  if (current.calendarSources.length === 0) return fail("no_sources", "No calendars are feeding Family yet.");

  const connection = await readConnection();
  if (connection.status === "broken") return fail("broken", connection.reason);
  if (connection.status === "none") return fail("disconnected", RECONNECT);

  const window = syncWindow(now);
  const summary: SyncSummary = { calendars: 0, written: 0, removed: 0, errors: [] };
  const updated: CalendarSource[] = [];

  for (const source of current.calendarSources) {
    const api: GoogleApi = {
      listEvents: async (input) => {
        const page = await withAccessToken((token) => listEvents(token, input));
        if (!page) throw new Error(RECONNECT);
        return page;
      },
    };

    const result = await syncCalendar(getDb(), api, {
      calendarId: source.calendarId,
      timeZone: current.timezone,
      window,
    });

    summary.calendars++;
    summary.written += result.written;
    summary.removed += result.removed;
    if (result.error) summary.errors.push(`${source.summary}: ${result.error}`);

    updated.push({
      ...source,
      lastSyncedAt: new Date().toISOString(),
      lastError: result.error ?? null,
    });
  }

  await writeSources(updated);
  return { ok: true, data: summary };
}

export async function disconnectGoogle(): Promise<Result<{ removed: number }>> {
  const current = await getSettings();
  const connection = await readConnection();

  if (connection.status === "ok") await revokeToken(connection.tokens.refreshToken);

  let removed = 0;
  for (const source of current.calendarSources) {
    removed += await removeCalendarEvents(getDb(), source.calendarId);
  }

  await writeSources([]);
  await forgetConnection();
  return { ok: true, data: { removed } };
}

/** How many local events would go if Devon disconnected, so the confirm can say so. */
export async function syncedEventCount(): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(calendarEvents)
    .where(eq(calendarEvents.source, "google"));
  return row?.n ?? 0;
}
