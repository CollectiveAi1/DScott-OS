import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { addDays, dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { dayBounds, dayGrid, monthGrid, startOfWeek, weekGrid } from "@/lib/zoned";
import { Agenda } from "@/modules/schedule/components/agenda";
import { MonthGridView } from "@/modules/schedule/components/month";
import { TimeGrid, type GridDay } from "@/modules/schedule/components/time-grid";
import { conflictedEventIds, conflictsInRange, eventsInRange, type CalendarEvent } from "@/modules/schedule/queries";

export const metadata: Metadata = { title: "Schedule" };

const VIEWS = ["agenda", "week", "day", "month"] as const;
type View = (typeof VIEWS)[number];

const AGENDA_DAYS = 14;

function one(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function isDate(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const db = getDb();
  const { timezone, protectedTime } = await getSettings();
  const params = await searchParams;

  const today = dateInZone(new Date(), timezone);
  const date = isDate(one(params, "date")) ? (one(params, "date") as string) : today;
  const requested = VIEWS.find((view) => view === one(params, "view")) ?? null;

  // With no view chosen, Agenda and Week are both rendered and CSS picks: Agenda on phones,
  // Week on desktop (PRD §8.3), with no server-side viewport guess and no flash.
  const shows = (view: View) => requested === null || requested === view;

  const agendaDays = Array.from({ length: AGENDA_DAYS }, (_, index) => addDays(date, index));
  const week = weekGrid(date, timezone);
  const day = dayGrid(date, timezone);
  const month = monthGrid(date, timezone);

  // One read wide enough for whichever views are on screen.
  const from = new Date(
    Math.min(
      ...[
        shows("agenda") ? dayGrid(agendaDays[0]!, timezone).from.getTime() : Infinity,
        shows("week") ? week.from.getTime() : Infinity,
        shows("day") ? day.from.getTime() : Infinity,
        shows("month") ? month.from.getTime() : Infinity,
      ],
    ),
  );
  const to = new Date(
    Math.max(
      ...[
        shows("agenda") ? dayGrid(agendaDays.at(-1)!, timezone).to.getTime() : -Infinity,
        shows("week") ? week.to.getTime() : -Infinity,
        shows("day") ? day.to.getTime() : -Infinity,
        shows("month") ? month.to.getTime() : -Infinity,
      ],
    ),
  );

  const events = await eventsInRange(db, from, to);
  const allDays = [...new Set([...agendaDays, ...week.days, ...day.days, ...month.days])];
  const conflicts = await conflictsInRange(db, from, to, protectedTime, timezone, allDays);
  const conflicted = conflictedEventIds(conflicts);

  const boundsFor = (days: string[]): GridDay[] => dayBounds(days, timezone);
  const monthBounds = new Map(boundsFor(month.days).map((entry) => [entry.date, entry]));

  const weekdayNames = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" });
  const dayLabel = (value: string) => ({
    weekday: weekdayNames.format(dayGrid(value, timezone).from),
    day: value.slice(8),
    isToday: value === today,
  });

  const link = (next: { view?: View | null; date?: string }) => {
    const query = new URLSearchParams();
    const view = next.view === undefined ? requested : next.view;
    if (view) query.set("view", view);
    const target = next.date ?? date;
    if (target !== today) query.set("date", target);
    const text = query.toString();
    return `/schedule${text ? `?${text}` : ""}`;
  };
  const hrefFor = (event: CalendarEvent) => `/schedule/${event.id}`;

  const step = requested === "month" ? 30 : requested === "day" ? 1 : 7;
  const back = requested === "month" ? `${addDays(`${month.month}-01`, -1).slice(0, 8)}01` : addDays(date, -step);
  const forward =
    requested === "month" ? addDays(`${month.month}-01`, 32).slice(0, 8) + "01" : addDays(date, step);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Schedule</h1>
        <Link
          href="/schedule/new"
          className="rounded-[--radius-control] bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          New event
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <nav aria-label="View" className="flex flex-wrap gap-2">
          <Link
            href={link({ view: null })}
            aria-current={requested === null ? "page" : undefined}
            className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent aria-[current=page]:border-accent aria-[current=page]:text-accent"
          >
            Default
          </Link>
          {VIEWS.map((view) => (
            <Link
              key={view}
              href={link({ view })}
              aria-current={requested === view ? "page" : undefined}
              className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm capitalize text-ink hover:border-accent hover:text-accent aria-[current=page]:border-accent aria-[current=page]:text-accent"
            >
              {view}
            </Link>
          ))}
        </nav>
        <span className="flex items-center gap-2">
          <Link href={link({ date: back })} className="rounded-[--radius-control] border border-line-strong px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-accent">
            ← Back
          </Link>
          <Link href={link({ date: today })} className="rounded-[--radius-control] border border-line-strong px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-accent">
            Today
          </Link>
          <Link href={link({ date: forward })} className="rounded-[--radius-control] border border-line-strong px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-accent">
            Forward →
          </Link>
        </span>
      </div>

      {shows("agenda") ? (
        <section aria-label="Agenda" className={requested === null ? "md:hidden" : ""}>
          <h2 className="mb-3 text-sm text-muted">
            Next {AGENDA_DAYS} days from {date}
          </h2>
          <Agenda
            days={boundsFor(agendaDays)}
            events={events}
            timeZone={timezone}
            conflicted={conflicted}
            hrefFor={hrefFor}
            dayLabel={dayLabel}
          />
        </section>
      ) : null}

      {shows("week") ? (
        <section aria-label="Week" className={requested === null ? "hidden md:block" : ""}>
          <h2 className="mb-3 text-sm text-muted">Week of {startOfWeek(date)}</h2>
          <TimeGrid
            days={boundsFor(week.days)}
            events={events}
            blocks={protectedTime}
            timeZone={timezone}
            conflicted={conflicted}
            hrefFor={hrefFor}
            dayLabel={dayLabel}
          />
        </section>
      ) : null}

      {shows("day") && requested === "day" ? (
        <section aria-label="Day">
          <h2 className="mb-3 text-sm text-muted">{date}</h2>
          <TimeGrid
            days={boundsFor(day.days)}
            events={events}
            blocks={protectedTime}
            timeZone={timezone}
            conflicted={conflicted}
            hrefFor={hrefFor}
            dayLabel={dayLabel}
          />
        </section>
      ) : null}

      {shows("month") && requested === "month" ? (
        <section aria-label="Month">
          <h2 className="mb-3 text-sm text-muted">{month.month}</h2>
          <MonthGridView
            weeks={month.weeks}
            bounds={monthBounds}
            events={events}
            timeZone={timezone}
            conflicted={conflicted}
            inMonth={month.inMonth}
            hrefFor={hrefFor}
            dayHref={(value) => `/schedule?view=day&date=${value}`}
            today={today}
          />
        </section>
      ) : null}

      {protectedTime.length > 0 && (requested === "week" || requested === "day" || requested === null) ? (
        <p className="mt-4 text-xs text-muted">
          Hatched blocks are protected time.{" "}
          <Link href="/settings" className="underline hover:text-ink">
            Change it in Settings
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
