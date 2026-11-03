import type { ProtectedBlock } from "@/db/schema";
import { minutesOfDay, weekdayOf } from "@/lib/dates";
import { minutesIntoDay } from "@/lib/zoned";
import { EventChip, eventColor } from "./event-chip";
import { ScrollToHour } from "./scroll-to-hour";
import type { CalendarEvent } from "../queries";

const SLOT_MINUTES = 30;
const SLOTS = (24 * 60) / SLOT_MINUTES;
const DAY_MINUTES = 24 * 60;

type Placed = { event: CalendarEvent; startRow: number; endRow: number; column: number; columns: number };

/**
 * Lay a day's timed events out side by side where they overlap. Events are walked in start
 * order and grouped into clusters that touch; every member of a cluster gets an equal share of
 * the width, so nothing is hidden behind anything else.
 */
function placeDay(events: CalendarEvent[], date: string, timeZone: string): Placed[] {
  const spans = events
    .map((event) => {
      const rawStart = minutesIntoDay(event.startsAt, date, timeZone);
      const rawEnd = minutesIntoDay(event.endsAt, date, timeZone);
      // Clip to this day: an event running past midnight continues in the next column.
      const start = Math.max(0, Math.min(rawStart, DAY_MINUTES));
      const end = Math.max(start + SLOT_MINUTES, Math.min(rawEnd, DAY_MINUTES));
      return { event, start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const placed: Placed[] = [];
  let cluster: typeof spans = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    // Within a cluster, assign each event the first column whose last event has finished.
    const columnEnds: number[] = [];
    const assigned = cluster.map((span) => {
      let column = columnEnds.findIndex((end) => end <= span.start);
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = span.end;
      return { ...span, column };
    });
    const columns = columnEnds.length;
    for (const span of assigned) {
      placed.push({
        event: span.event,
        startRow: Math.floor(span.start / SLOT_MINUTES) + 1,
        endRow: Math.ceil(span.end / SLOT_MINUTES) + 1,
        column: span.column,
        columns,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const span of spans) {
    if (cluster.length > 0 && span.start >= clusterEnd) flush();
    cluster.push(span);
    clusterEnd = Math.max(clusterEnd, span.end);
  }
  flush();
  return placed;
}

/** Protected time as rows to paint behind the events, for the weekday this column shows. */
function protectedRows(blocks: ProtectedBlock[], date: string): { startRow: number; endRow: number; label: string }[] {
  const weekday = weekdayOf(date);
  return blocks
    .filter((block) => block.days.includes(weekday))
    .map((block) => ({
      startRow: Math.floor(minutesOfDay(block.start) / SLOT_MINUTES) + 1,
      endRow: Math.ceil(minutesOfDay(block.end) / SLOT_MINUTES) + 1,
      label: block.label,
    }));
}

const HATCH =
  "repeating-linear-gradient(45deg, var(--color-line) 0 4px, transparent 4px 10px)";

/** A column: the calendar date it shows and the half-open instant range it covers. */
export type GridDay = { date: string; from: Date; to: Date };

export function TimeGrid({
  days,
  events,
  blocks,
  timeZone,
  conflicted,
  hrefFor,
  dayLabel,
}: {
  days: GridDay[];
  events: CalendarEvent[];
  blocks: ProtectedBlock[];
  timeZone: string;
  conflicted: Set<string>;
  hrefFor: (event: CalendarEvent) => string;
  dayLabel: (date: string) => { weekday: string; day: string; isToday: boolean };
}) {
  const allDay = events.filter((event) => event.allDay);
  const timed = events.filter((event) => !event.allDay);

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: days.length > 1 ? `${days.length * 120 + 56}px` : undefined }}>
        {/* Day headings */}
        <div className="grid border-b border-line" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map(({ date }) => {
            const label = dayLabel(date);
            return (
              <div key={date} className="px-1 pb-2 text-center">
                <p className="text-[11px] uppercase tracking-wider text-muted">{label.weekday}</p>
                <p className={`font-mono text-sm ${label.isToday ? "text-accent" : "text-ink"}`}>{label.day}</p>
              </div>
            );
          })}
        </div>

        {/* All-day strip. Always present so the grid below never shifts. */}
        <div
          className="grid border-b border-line"
          style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}
        >
          <div className="py-1 pr-2 text-right font-mono text-[10px] text-muted">all day</div>
          {days.map(({ date, from, to }) => (
            <div key={date} className="min-h-7 space-y-0.5 border-l border-line p-0.5">
              {allDay
                .filter((event) => event.startsAt < to && event.endsAt > from)
                .map((event) => (
                  <EventChip
                    key={event.id}
                    event={event}
                    timeZone={timeZone}
                    href={hrefFor(event)}
                    conflicted={conflicted.has(event.id)}
                    compact
                  />
                ))}
            </div>
          ))}
        </div>

        {/* The hours. Scrolls, and opens at 07:00 rather than at midnight. */}
        <div className="max-h-[32rem] overflow-y-auto" data-hours>
          <ScrollToHour hour={7} />
          <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, 1fr)` }}>
            {/* Hour labels */}
            <div className="grid" style={{ gridTemplateRows: `repeat(${SLOTS}, 1.25rem)` }}>
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="relative -top-2 pr-2 text-right font-mono text-[10px] text-muted"
                  style={{ gridRow: `${hour * 2 + 1} / span 2` }}
                >
                  {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
                </div>
              ))}
            </div>

            {days.map(({ date, from, to }) => (
              <div
                key={date}
                className="relative grid border-l border-line"
                style={{ gridTemplateRows: `repeat(${SLOTS}, 1.25rem)` }}
              >
                {/* Hour lines */}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="border-t border-line/50" style={{ gridRow: `${hour * 2 + 1} / span 2` }} />
                ))}

                {/* Protected time, painted behind */}
                {protectedRows(blocks, date).map((block, index) => (
                  <div
                    key={`${block.label}-${index}`}
                    title={`Protected: ${block.label}`}
                    aria-label={`Protected time: ${block.label}`}
                    className="pointer-events-none"
                    style={{ gridRow: `${block.startRow} / ${block.endRow}`, gridColumn: 1, background: HATCH }}
                  />
                ))}

                {/* Events */}
                {placeDay(
                  timed.filter((event) => event.startsAt < to && event.endsAt > from),
                  date,
                  timeZone,
                ).map((slot) => (
                  <div
                    key={slot.event.id}
                    className="px-px"
                    style={{
                      gridRow: `${slot.startRow} / ${slot.endRow}`,
                      gridColumn: 1,
                      marginLeft: `${(slot.column / slot.columns) * 100}%`,
                      width: `${100 / slot.columns}%`,
                    }}
                  >
                    <div className="h-full overflow-hidden" style={{ borderColor: eventColor(slot.event.arena) }}>
                      <EventChip
                        event={slot.event}
                        timeZone={timeZone}
                        href={hrefFor(slot.event)}
                        conflicted={conflicted.has(slot.event.id)}
                        compact
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
