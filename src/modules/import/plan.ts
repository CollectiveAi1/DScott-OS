import { startOfDayInstant, zonedTimeToInstant } from "@/lib/zoned";
import { moveKey, rowIdentity } from "./identity";
import { exclusiveEndDate, type ParsedRow, type RowError } from "./parse";

/** An existing imported event, as the plan needs to see it. */
export type ExistingEvent = {
  id: string;
  externalId: string | null;
  title: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
};

export type PlannedEvent = {
  externalId: string;
  title: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  /** The row it came from, for the preview's line numbers and assumptions. */
  row: ParsedRow;
};

export type PlanEntry =
  | { kind: "new"; event: PlannedEvent }
  | { kind: "unchanged"; event: PlannedEvent; existingId: string }
  | { kind: "changed"; event: PlannedEvent; existingId: string; was: ExistingEvent; moved: boolean };

export type ImportPlan = {
  entries: PlanEntry[];
  /** Future events from earlier imports this file no longer contains. */
  removals: ExistingEvent[];
  errors: RowError[];
  counts: { new: number; changed: number; unchanged: number; removed: number; errors: number };
};

/** A parsed row as the pair of instants it will be stored with (SPEC-003 §2). */
export function toInstants(row: ParsedRow, timeZone: string): { startsAt: Date; endsAt: Date } {
  if (row.allDay) {
    return {
      startsAt: startOfDayInstant(row.date, timeZone),
      endsAt: startOfDayInstant(exclusiveEndDate(row), timeZone),
    };
  }
  return {
    startsAt: zonedTimeToInstant(row.date, row.start!, timeZone),
    endsAt: zonedTimeToInstant(row.date, row.end!, timeZone),
  };
}

function differs(planned: PlannedEvent, existing: ExistingEvent): boolean {
  return (
    planned.title !== existing.title ||
    planned.kind !== existing.kind ||
    planned.allDay !== existing.allDay ||
    planned.startsAt.getTime() !== existing.startsAt.getTime() ||
    planned.endsAt.getTime() !== existing.endsAt.getTime() ||
    (planned.location ?? null) !== (existing.location ?? null)
  );
}

/**
 * The whole import, decided before anything is written: what is new, what changed, what is
 * untouched, and what would be removed.
 *
 * Removal reaches **future events only**. A past game dropped from a revised schedule stays —
 * it happened, and the record is worth more than a tidy table.
 */
export function buildPlan(input: {
  rows: ParsedRow[];
  errors: RowError[];
  existing: ExistingEvent[];
  timeZone: string;
  now: Date;
}): ImportPlan {
  const { rows, errors, existing, timeZone, now } = input;

  const planned: PlannedEvent[] = rows.map((row) => {
    const { startsAt, endsAt } = toInstants(row, timeZone);
    return {
      externalId: rowIdentity(row),
      title: row.title,
      kind: row.kind,
      startsAt,
      endsAt,
      allDay: row.allDay,
      location: row.location,
      notes: row.notes,
      row,
    };
  });

  const byExternalId = new Map(existing.filter((event) => event.externalId).map((event) => [event.externalId!, event]));
  const matchedIds = new Set<string>();
  const entries: PlanEntry[] = [];
  const unmatched: PlannedEvent[] = [];

  for (const event of planned) {
    const found = byExternalId.get(event.externalId);
    if (!found) {
      unmatched.push(event);
      continue;
    }
    matchedIds.add(found.id);
    entries.push(
      differs(event, found)
        ? { kind: "changed", event, existingId: found.id, was: found, moved: false }
        : { kind: "unchanged", event, existingId: found.id },
    );
  }

  // Everything the file no longer accounts for, and that has not already happened.
  const orphans = existing.filter((event) => !matchedIds.has(event.id) && event.startsAt.getTime() >= now.getTime());

  // A row whose id is new, against an orphan with the same day, type and title, is the same
  // event at a different time. Pair them so it reads — and writes — as a move.
  const orphansByMoveKey = new Map<string, ExistingEvent[]>();
  for (const orphan of orphans) {
    const key = moveKey({ date: dateKeyOf(orphan, timeZone), kind: orphan.kind, title: orphan.title });
    orphansByMoveKey.set(key, [...(orphansByMoveKey.get(key) ?? []), orphan]);
  }

  const pairedOrphanIds = new Set<string>();
  for (const event of unmatched) {
    const key = moveKey(event.row);
    const candidates = (orphansByMoveKey.get(key) ?? []).filter((orphan) => !pairedOrphanIds.has(orphan.id));
    const sameKeyRows = unmatched.filter((other) => moveKey(other.row) === key);

    // Only when it is unambiguous on both sides. Two practices with the same name on the same
    // day fall back to add-and-remove: guessing which one moved would be worse than saying so.
    if (candidates.length === 1 && sameKeyRows.length === 1) {
      const orphan = candidates[0]!;
      pairedOrphanIds.add(orphan.id);
      entries.push({ kind: "changed", event, existingId: orphan.id, was: orphan, moved: true });
    } else {
      entries.push({ kind: "new", event });
    }
  }

  const removals = orphans.filter((orphan) => !pairedOrphanIds.has(orphan.id));

  return {
    entries,
    removals,
    errors,
    counts: {
      new: entries.filter((entry) => entry.kind === "new").length,
      changed: entries.filter((entry) => entry.kind === "changed").length,
      unchanged: entries.filter((entry) => entry.kind === "unchanged").length,
      removed: removals.length,
      errors: errors.length,
    },
  };
}

/** The local calendar date an existing event falls on, for move matching. */
function dateKeyOf(event: ExistingEvent, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(event.startsAt);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
