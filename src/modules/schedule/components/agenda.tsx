import type { GridDay } from "./time-grid";
import { EventChip } from "./event-chip";
import type { CalendarEvent } from "../queries";

/**
 * The next stretch of days as a list. Default on phones, where a 24-hour grid is unreadable:
 * what matters there is what is next, not where it sits on a clock face.
 */
export function Agenda({
  days,
  events,
  timeZone,
  conflicted,
  hrefFor,
  dayLabel,
}: {
  days: GridDay[];
  events: CalendarEvent[];
  timeZone: string;
  conflicted: Set<string>;
  hrefFor: (event: CalendarEvent) => string;
  dayLabel: (date: string) => { weekday: string; day: string; isToday: boolean };
}) {
  const withEvents = days
    .map((day) => ({
      ...day,
      // All-day first, then by start time: the order the day is actually lived in.
      items: events
        .filter((event) => event.startsAt < day.to && event.endsAt > day.from)
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.getTime() - b.startsAt.getTime()),
    }))
    .filter((day) => day.items.length > 0);

  if (withEvents.length === 0) {
    return (
      <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
        Nothing scheduled in this stretch. Add an event, or import the team schedule when it arrives.
      </p>
    );
  }

  return (
    <ol className="space-y-5">
      {withEvents.map((day) => {
        const label = dayLabel(day.date);
        return (
          <li key={day.date}>
            <h3 className={`mb-2 text-sm font-semibold ${label.isToday ? "text-accent" : "text-ink"}`}>
              {label.weekday} {label.day}
              {label.isToday ? " · today" : ""}
            </h3>
            <ul className="space-y-1">
              {day.items.map((event) => (
                <li key={event.id}>
                  <EventChip
                    event={event}
                    timeZone={timeZone}
                    href={hrefFor(event)}
                    conflicted={conflicted.has(event.id)}
                  />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
