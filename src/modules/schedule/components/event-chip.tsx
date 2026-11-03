import Link from "next/link";
import { arenaLabel, type ArenaName } from "@/components/arena-tag";
import { instantToZonedParts } from "@/lib/zoned";
import { kindLabel } from "../kinds";
import type { CalendarEvent } from "../queries";

const ARENA_COLOR: Record<string, string> = {
  collective: "var(--color-arena-collective)",
  basketball: "var(--color-arena-basketball)",
  family: "var(--color-arena-family)",
  misc: "var(--color-arena-misc)",
};

export function eventColor(arena: string): string {
  return ARENA_COLOR[arena] ?? ARENA_COLOR.misc!;
}

export function eventTime(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) return "All day";
  return instantToZonedParts(event.startsAt, timeZone).time;
}

export function eventRange(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) return "All day";
  return `${instantToZonedParts(event.startsAt, timeZone).time}–${instantToZonedParts(event.endsAt, timeZone).time}`;
}

/**
 * One event wherever it appears. The arena is carried by a colour bar and the label together:
 * colour is never the only signal (PRD §8.0).
 */
export function EventChip({
  event,
  timeZone,
  href,
  conflicted,
  compact = false,
}: {
  event: CalendarEvent;
  timeZone: string;
  href: string;
  conflicted: boolean;
  compact?: boolean;
}) {
  const color = eventColor(event.arena);
  return (
    <Link
      href={href}
      style={{ borderLeftColor: color }}
      className={`block min-w-0 overflow-hidden rounded-[--radius-control] border border-line border-l-[3px] bg-surface-raised hover:border-accent ${
        compact ? "px-1.5 py-0.5" : "px-2 py-1"
      }`}
    >
      <span className={`block truncate ${compact ? "text-[11px]" : "text-xs"} text-ink`}>
        {conflicted ? (
          <span className="mr-1 text-danger" title="Conflict">
            ⚠
          </span>
        ) : null}
        {event.title}
      </span>
      {compact ? null : (
        <span className="block truncate font-mono text-[10px] text-muted">
          {eventRange(event, timeZone)} · {arenaLabel(event.arena as ArenaName)}
          {event.kind === "other" ? "" : ` · ${kindLabel(event.kind)}`}
        </span>
      )}
    </Link>
  );
}
