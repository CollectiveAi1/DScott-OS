import Link from "next/link";
import { EventChip } from "./event-chip";
import type { GridDay } from "./time-grid";
import type { CalendarEvent } from "../queries";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PER_CELL = 3;

/**
 * Six weeks, always. A fixed height keeps the grid from reflowing as Devon pages through
 * months. Cells list events for orientation; Week and Day are where overlap is read.
 */
export function MonthGridView({
  weeks,
  bounds,
  events,
  timeZone,
  conflicted,
  inMonth,
  hrefFor,
  dayHref,
  today,
}: {
  weeks: string[][];
  bounds: Map<string, GridDay>;
  events: CalendarEvent[];
  timeZone: string;
  conflicted: Set<string>;
  inMonth: (date: string) => boolean;
  hrefFor: (event: CalendarEvent) => string;
  dayHref: (date: string) => string;
  today: string;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-line">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="px-2 pb-2 text-[11px] uppercase tracking-wider text-muted">
              {weekday}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {weeks.flat().map((date) => {
            const day = bounds.get(date);
            const items = day
              ? events
                  .filter((event) => event.startsAt < day.to && event.endsAt > day.from)
                  .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.getTime() - b.startsAt.getTime())
              : [];
            const extra = items.length - PER_CELL;

            return (
              <div
                key={date}
                className={`min-h-24 space-y-0.5 border-b border-r border-line p-1 ${
                  inMonth(date) ? "" : "bg-base/40"
                }`}
              >
                <Link
                  href={dayHref(date)}
                  className={`block font-mono text-[11px] hover:text-accent ${
                    date === today ? "text-accent" : inMonth(date) ? "text-ink" : "text-muted/60"
                  }`}
                >
                  {date.slice(8)}
                </Link>
                {items.slice(0, PER_CELL).map((event) => (
                  <EventChip
                    key={event.id}
                    event={event}
                    timeZone={timeZone}
                    href={hrefFor(event)}
                    conflicted={conflicted.has(event.id)}
                    compact
                  />
                ))}
                {extra > 0 ? (
                  <Link href={dayHref(date)} className="block px-1 text-[10px] text-muted hover:text-accent">
                    +{extra} more
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
