import type { calendarKindEnum } from "@/db/schema";

export type EventKind = (typeof calendarKindEnum.enumValues)[number];
export type EventArena = "collective" | "basketball" | "family" | "misc";

const LABELS: Record<EventKind, string> = {
  practice: "Practice",
  s_and_c: "S&C",
  team_event: "Team event",
  game: "Game",
  travel: "Travel",
  family: "Family",
  deadline: "Deadline",
  other: "Other",
};

/** Basketball runs on its own vocabulary; everything else shares a short list. */
const BY_ARENA: Record<EventArena, EventKind[]> = {
  basketball: ["practice", "s_and_c", "team_event", "game", "travel"],
  collective: ["deadline", "other"],
  family: ["family", "deadline", "other"],
  misc: ["deadline", "other"],
};

export function kindsForArena(arena: EventArena): { value: EventKind; label: string }[] {
  return BY_ARENA[arena].map((kind) => ({ value: kind, label: LABELS[kind] }));
}

export function kindLabel(kind: string): string {
  return LABELS[kind as EventKind] ?? "Other";
}

export function kindAllowedForArena(arena: EventArena, kind: EventKind): boolean {
  return BY_ARENA[arena].includes(kind);
}

/** Travel is a journey, not an appointment: all-day, departure through return. */
export function defaultsAllDay(kind: EventKind): boolean {
  return kind === "travel";
}

export const SOURCE_LABEL: Record<string, string> = {
  manual: "Added here",
  google: "From Google Calendar",
  import: "From a schedule import",
};

/** Only notes may be edited on a row another system owns. */
export function isReadOnlySource(source: string): boolean {
  return source === "google" || source === "import";
}
