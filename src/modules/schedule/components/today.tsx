import Link from "next/link";
import { arenaLabel, type ArenaName } from "@/components/arena-tag";
import { kindLabel } from "../kinds";
import type { CalendarEvent } from "../queries";
import { eventColor, eventRange } from "./event-chip";

/**
 * Today's calendar on Command, in full.
 *
 * Every source: manual, imported and Google. The question this answers is "what does today
 * actually hold", and an event is no less real for having come from somewhere else.
 */
export function TodaySchedule({ events, timeZone }: { events: CalendarEvent[]; timeZone: string }) {
  return (
    <section aria-labelledby="today-heading" className="mt-10">
      <h2 id="today-heading" className="mb-3 text-lg font-semibold">
        Today&rsquo;s schedule
      </h2>

      {events.length === 0 ? (
        <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
          Nothing on the calendar today.{" "}
          <Link href="/schedule/new" className="text-accent underline">
            Add an event
          </Link>{" "}
          or{" "}
          <Link href="/schedule" className="underline hover:text-ink">
            open the schedule
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 self-center rounded-full"
                style={{ background: eventColor(event.arena) }}
              />
              <span className="font-mono text-xs text-muted">{eventRange(event, timeZone)}</span>
              <Link href={`/schedule/${event.id}`} className="text-sm text-ink hover:text-accent">
                {event.title}
              </Link>
              <span className="ml-auto text-xs text-muted">
                {arenaLabel(event.arena as ArenaName)} · {kindLabel(event.kind)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
