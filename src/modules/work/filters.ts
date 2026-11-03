import { addDays } from "@/lib/dates";
import type { Arena, Priority } from "./capture";

export type DueWindow = "any" | "overdue" | "today" | "week" | "none";
export type StatusFilter = "open" | "done" | "any";
export type WorkView = "board" | "list";

export type WorkFilters = {
  view: WorkView;
  board: string | null;
  arena: Arena | "any";
  priority: Priority | "any";
  due: DueWindow;
  status: StatusFilter;
  task: string | null;
};

export const ARENA_OPTIONS = [
  { value: "any", label: "Every arena" },
  { value: "collective", label: "Collective AI" },
  { value: "basketball", label: "Basketball" },
  { value: "family", label: "Family" },
  { value: "misc", label: "Misc" },
] as const;

export const PRIORITY_OPTIONS = [
  { value: "any", label: "Any priority" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
] as const;

export const DUE_OPTIONS = [
  { value: "any", label: "Any date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "none", label: "No date" },
] as const;

export const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "any", label: "Open and done" },
] as const;

const DEFAULTS = { view: "board", arena: "any", priority: "any", due: "any", status: "open" } as const;

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/** Query string in, typed filters out. Anything unrecognised falls back to its default. */
export function parseFilters(params: Record<string, string | string[] | undefined>): WorkFilters {
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    view: pick(one("view"), ["board", "list"] as const, DEFAULTS.view),
    board: one("board") ?? null,
    arena: pick(one("arena"), ARENA_OPTIONS.map((option) => option.value), DEFAULTS.arena),
    priority: pick(one("priority"), PRIORITY_OPTIONS.map((option) => option.value), DEFAULTS.priority),
    due: pick(one("due"), DUE_OPTIONS.map((option) => option.value), DEFAULTS.due),
    status: pick(one("status"), STATUS_OPTIONS.map((option) => option.value), DEFAULTS.status),
    task: one("task") ?? null,
  };
}

/** True when Devon has narrowed anything, so "Clear filters" is only offered when it would do something. */
export function hasActiveFilters(filters: WorkFilters): boolean {
  return (
    filters.arena !== DEFAULTS.arena ||
    filters.priority !== DEFAULTS.priority ||
    filters.due !== DEFAULTS.due ||
    filters.status !== DEFAULTS.status
  );
}

export type DueBounds =
  | { kind: "none" }
  | { kind: "any" }
  | { kind: "range"; from: string | null; to: string | null };

/**
 * A due window as calendar-date bounds, computed from today in the settings time zone.
 * "This week" is today through today + 7, which is the same window Command counts.
 */
export function dueBounds(due: DueWindow, today: string): DueBounds {
  switch (due) {
    case "any":
      return { kind: "any" };
    case "none":
      return { kind: "none" };
    case "overdue":
      return { kind: "range", from: null, to: addDays(today, -1) };
    case "today":
      return { kind: "range", from: today, to: today };
    case "week":
      return { kind: "range", from: today, to: addDays(today, 7) };
  }
}

/** The query string for a link that changes one filter and leaves the rest alone. */
export function filtersToQuery(filters: WorkFilters, overrides: Partial<WorkFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.view !== DEFAULTS.view) params.set("view", merged.view);
  if (merged.board) params.set("board", merged.board);
  if (merged.arena !== DEFAULTS.arena) params.set("arena", merged.arena);
  if (merged.priority !== DEFAULTS.priority) params.set("priority", merged.priority);
  if (merged.due !== DEFAULTS.due) params.set("due", merged.due);
  if (merged.status !== DEFAULTS.status) params.set("status", merged.status);
  if (merged.task) params.set("task", merged.task);
  const query = params.toString();
  return query ? `?${query}` : "";
}
