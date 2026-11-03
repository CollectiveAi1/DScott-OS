"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { disconnectAction, pickCalendarsAction, syncNowAction } from "../actions";

const initial: FormState = {};

export type CalendarOption = { id: string; summary: string; primary: boolean; picked: boolean };
export type SourceStatus = { calendarId: string; summary: string; lastSyncedAt?: string; lastError?: string | null };

function Disconnect({ eventCount }: { eventCount: number }) {
  const [state, action, pending] = useActionState(disconnectAction, initial);
  const [armed, setArmed] = useState(false);

  return (
    <form action={action} onSubmit={() => setArmed(true)} className="flex flex-wrap items-center gap-3">
      {armed ? <input type="hidden" name="confirm" value="yes" /> : null}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-[--radius-control] border px-3 py-2 text-sm disabled:opacity-60 ${
          armed ? "border-danger text-danger" : "border-line-strong text-muted hover:border-danger hover:text-danger"
        }`}
      >
        {armed ? `Really disconnect and remove ${eventCount} event(s)?` : "Disconnect"}
      </button>
      {armed ? <FormMessage state={state} /> : null}
    </form>
  );
}

function SyncNow() {
  const [state, action, pending] = useActionState(syncNowAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-[--radius-control] border border-line-strong px-3 py-2 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}

function CalendarPicker({ calendars }: { calendars: CalendarOption[] }) {
  const [state, action] = useActionState(pickCalendarsAction, initial);
  // Controlled, and the list is remounted when the action settles: React clears a form once its
  // action resolves, and a checkbox it cannot diff back into place would silently untick.
  const [picked, setPicked] = useState<string[]>(calendars.filter((c) => c.picked).map((c) => c.id));

  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));

  if (calendars.length === 0) {
    return <p className="mt-3 text-sm text-muted">Google returned no calendars for this account.</p>;
  }

  return (
    <form action={action} className="mt-4 space-y-3">
      <fieldset>
        <legend className="mb-2 text-sm text-muted">Calendars feeding Family</legend>
        <ul className="space-y-1.5">
          {calendars.map((calendar) => (
            <li key={calendar.id}>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="calendar"
                  value={`${calendar.id} ${calendar.summary}`}
                  checked={picked.includes(calendar.id)}
                  onChange={() => toggle(calendar.id)}
                  className="mt-1 accent-[--color-accent]"
                />
                <span>
                  {calendar.summary}
                  {calendar.primary ? <span className="ml-2 text-xs text-muted">primary</span> : null}
                  <span className="block font-mono text-[11px] text-muted">{calendar.id}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <FormMessage state={state} />
      <div className="max-w-48">
        <SubmitButton pendingLabel="Saving…">Save calendars</SubmitButton>
      </div>
    </form>
  );
}

function SourceList({ sources, timeZone }: { sources: SourceStatus[]; timeZone: string }) {
  if (sources.length === 0) return null;
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <ul className="mt-4 space-y-2 border-t border-line pt-4">
      {sources.map((source) => (
        <li key={source.calendarId}>
          <p className="text-sm text-ink">{source.summary}</p>
          <p className="font-mono text-xs text-muted">
            {source.lastSyncedAt ? `Last sync ${when.format(new Date(source.lastSyncedAt))}` : "Not synced yet"}
          </p>
          {source.lastError ? (
            <p role="status" className="text-xs text-danger">
              {source.lastError}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function GoogleConnection({
  status,
  reason,
  email,
  calendars,
  sources,
  eventCount,
  timeZone,
  callbackUrl,
  notice,
}: {
  status: "not_configured" | "none" | "ok" | "broken";
  reason?: string;
  email?: string;
  calendars: CalendarOption[];
  sources: SourceStatus[];
  eventCount: number;
  timeZone: string;
  callbackUrl: string;
  notice?: string;
}) {
  if (status === "not_configured") {
    return (
      <div className="mt-4 space-y-2 text-sm text-muted">
        <p>Google is not configured on this deployment. Set these and restart:</p>
        <ul className="font-mono text-xs">
          <li>GOOGLE_CLIENT_ID</li>
          <li>GOOGLE_CLIENT_SECRET</li>
          <li>APP_URL</li>
        </ul>
        <p>
          The OAuth client&rsquo;s redirect URI has to be exactly{" "}
          <span className="font-mono text-xs text-ink">{callbackUrl}</span>.
        </p>
        <p>
          Publish the Google Cloud app as well. A client left in Testing issues refresh tokens that expire after
          seven days, which means reconnecting every week.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {notice ? (
        <p role="status" className={`text-sm ${notice.startsWith("Connected") ? "text-accent" : "text-danger"}`}>
          {notice}
        </p>
      ) : null}

      {status === "broken" ? (
        <>
          <p role="alert" className="text-sm text-danger">
            {reason}
          </p>
          <SourceList sources={sources} timeZone={timeZone} />
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/api/google/start"
              className="inline-block rounded-[--radius-control] bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
            >
              Reconnect
            </a>
            {/* Reconnecting is the usual answer, but walking away has to be possible too:
                otherwise a revoked grant leaves its synced events with no way to clear them. */}
            <Disconnect eventCount={eventCount} />
          </div>
        </>
      ) : null}

      {status === "none" ? (
        <>
          <p className="text-sm text-muted">
            Read-only. The OS reads your calendar into the Family arena and never writes back.
          </p>
          <a
            href="/api/google/start"
            className="inline-block rounded-[--radius-control] bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
          >
            Connect Google Calendar
          </a>
        </>
      ) : null}

      {status === "ok" ? (
        <>
          <p className="text-sm text-muted">
            Connected{email ? ` as ${email}` : ""}. Read-only, synced about every ten minutes.
          </p>
          <CalendarPicker calendars={calendars} />
          <SourceList sources={sources} timeZone={timeZone} />
          <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
            <SyncNow />
            <Disconnect eventCount={eventCount} />
          </div>
        </>
      ) : null}
    </div>
  );
}
