"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmAction, previewAction, type ImportState } from "../actions";
import type { PlanEntry } from "../plan";

const initial: ImportState = {};

function Row({ children, tone = "ink" }: { children: React.ReactNode; tone?: "ink" | "muted" | "danger" }) {
  const color = tone === "danger" ? "text-danger" : tone === "muted" ? "text-muted" : "text-ink";
  return <li className={`border-b border-line py-2 text-sm last:border-b-0 ${color}`}>{children}</li>;
}

function when(entry: PlanEntry): string {
  const row = entry.event.row;
  return row.allDay
    ? `${row.date}${row.endDate && row.endDate !== row.date ? ` – ${row.endDate}` : ""} · all day`
    : `${row.date} ${row.start}–${row.end}`;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[--radius-panel] border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      <ul className="mt-2">{children}</ul>
    </section>
  );
}

export function Importer({ modelAvailable }: { modelAvailable: boolean }) {
  const [state, action, pending] = useActionState(previewAction, initial);
  const [confirmState, confirm, confirming] = useActionState(confirmAction, initial);

  const plan = state.plan;
  const added = plan?.entries.filter((entry) => entry.kind === "new") ?? [];
  const changed = plan?.entries.filter((entry) => entry.kind === "changed") ?? [];
  const unchanged = plan?.entries.filter((entry) => entry.kind === "unchanged") ?? [];
  const assumed = plan?.entries.filter((entry) => entry.event.row.assumedEnd) ?? [];

  if (confirmState.done) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm text-accent">
          {confirmState.ok}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/schedule"
            className="rounded-[--radius-control] bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
          >
            Open Schedule
          </Link>
          <Link href="/schedule/import" className="text-sm text-muted underline hover:text-ink">
            Import another
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <form action={action} className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">Paste the schedule</span>
          <textarea
            name="text"
            rows={10}
            defaultValue={state.text}
            placeholder={"date,start,end,type,title,location,notes\n2026-11-07,18:00,20:30,game,Home vs Dayton,Covelli Center,"}
            className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 font-mono text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <span className="mt-1 block text-xs text-muted">
            CSV or tab-separated, with a header line. Columns: date, start, end, type, title, location, notes — plus
            end_date for travel. Types: practice, s&amp;c, team event, game, travel.
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">…or choose a file</span>
          <input
            type="file"
            name="file"
            accept={modelAvailable ? ".csv,.tsv,text/csv,application/pdf,image/*" : ".csv,.tsv,text/csv"}
            className="block w-full text-sm text-muted file:mr-3 file:rounded-[--radius-control] file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
          <span className="mt-1 block text-xs text-muted">
            {modelAvailable
              ? "CSV, or a PDF or image the Operator will read. Up to 8 MB."
              : "CSV only. Reading a PDF, an image or free text needs a model key (ANTHROPIC_API_KEY)."}
          </span>
        </label>

        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-[--radius-control] bg-accent px-4 py-2.5 font-semibold text-accent-ink disabled:opacity-60"
        >
          {pending ? "Reading…" : "Preview import"}
        </button>
      </form>

      {plan ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line pt-6">
            <h2 className="text-lg font-semibold">Preview</h2>
            <p className="font-mono text-xs text-muted">
              {plan.counts.new} new · {plan.counts.changed} changed · {plan.counts.unchanged} unchanged ·{" "}
              {plan.counts.removed} to remove · {plan.counts.errors} with errors
            </p>
          </div>

          {plan.errors.length > 0 ? (
            <Group title={`Rows with errors (${plan.errors.length})`} hint="These are not imported. Everything else still is.">
              {plan.errors.map((error) => (
                <Row key={`${error.line}-${error.message}`} tone="danger">
                  <span className="font-mono text-xs">Line {error.line}</span> · {error.message}
                </Row>
              ))}
            </Group>
          ) : null}

          {assumed.length > 0 ? (
            <Group title={`Assumed end times (${assumed.length})`} hint="No end time was given, so one was worked out: two hours for a game, ninety minutes otherwise.">
              {assumed.map((entry) => (
                <Row key={entry.event.externalId} tone="muted">
                  {entry.event.title} · {when(entry)}
                </Row>
              ))}
            </Group>
          ) : null}

          {added.length > 0 ? (
            <Group title={`New (${added.length})`}>
              {added.map((entry) => (
                <Row key={entry.event.externalId}>
                  {entry.event.title} <span className="font-mono text-xs text-muted">{when(entry)}</span>
                </Row>
              ))}
            </Group>
          ) : null}

          {changed.length > 0 ? (
            <Group title={`Changed (${changed.length})`}>
              {changed.map((entry) =>
                entry.kind === "changed" ? (
                  <Row key={entry.event.externalId}>
                    {entry.event.title} <span className="font-mono text-xs text-muted">{when(entry)}</span>
                    {entry.moved ? <span className="ml-2 text-xs text-muted">moved</span> : null}
                  </Row>
                ) : null,
              )}
            </Group>
          ) : null}

          {plan.removals.length > 0 ? (
            <Group
              title={`Will be removed (${plan.removals.length})`}
              hint="Future events from an earlier import that this file no longer contains. Past events are always kept."
            >
              {plan.removals.map((event) => (
                <Row key={event.id} tone="danger">
                  {event.title}
                </Row>
              ))}
            </Group>
          ) : null}

          {unchanged.length > 0 ? (
            <Group title={`Already up to date (${unchanged.length})`}>
              {unchanged.map((entry) => (
                <Row key={entry.event.externalId} tone="muted">
                  {entry.event.title} <span className="font-mono text-xs">{when(entry)}</span>
                </Row>
              ))}
            </Group>
          ) : null}

          {plan.counts.new + plan.counts.changed + plan.counts.removed === 0 ? (
            <p className="text-sm text-muted">Nothing would change. This schedule is already imported.</p>
          ) : (
            <form action={confirm} className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              {state.text ? <input type="hidden" name="text" value={state.text} /> : null}
              {state.rows ? <input type="hidden" name="rows" value={JSON.stringify(state.rows)} /> : null}
              <button
                type="submit"
                disabled={confirming}
                className="rounded-[--radius-control] bg-accent px-4 py-2.5 font-semibold text-accent-ink disabled:opacity-60"
              >
                {confirming ? "Importing…" : "Confirm import"}
              </button>
              {confirmState.error ? (
                <p role="alert" className="text-sm text-danger">
                  {confirmState.error}
                </p>
              ) : null}
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
