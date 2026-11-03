import { addDays, nextWeekday } from "@/lib/dates";
import type { arenaEnum, priorityEnum } from "@/db/schema";

export type Arena = (typeof arenaEnum.enumValues)[number];
export type Priority = (typeof priorityEnum.enumValues)[number];

export type ParsedCapture = {
  title: string;
  arena: Arena;
  priority: Priority;
  due: string | null;
};

export type CaptureResult = { ok: true; capture: ParsedCapture } | { ok: false; error: string };

const MAX_TITLE = 200;

const ARENAS: Arena[] = ["collective", "basketball", "family", "misc"];
const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// A token has to stand alone: "C#collective" in a title is not an arena tag.
const TOKEN = /(?:^|\s)(#[a-z]+|![a-z]+|due:[a-z0-9-]+)(?=\s|$)/gi;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date: 2026-13-45 and 2026-02-30 are not. */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function resolveDue(value: string, today: string): string | null {
  if (value === "today") return today;
  if (value === "tomorrow") return addDays(today, 1);
  const weekday = WEEKDAYS.indexOf(value);
  if (weekday >= 0) return nextWeekday(today, weekday + 1);
  return isRealDate(value) ? value : null;
}

/**
 * One line of quick capture into a task. `today` is the calendar date in the settings time zone,
 * so "tomorrow" means Devon's tomorrow rather than the server's.
 *
 * Anything it does not recognise stays in the title. A capture that silently dropped a word
 * would be worse than one that shows it did not understand.
 */
export function parseCapture(input: string, today: string): CaptureResult {
  let arena: Arena = "misc";
  let priority: Priority = "normal";
  let due: string | null = null;

  const title = input
    .replace(TOKEN, (match, raw: string) => {
      const token = raw.toLowerCase();
      const value = token.startsWith("due:") ? token.slice(4) : token.slice(1);
      const leading = match[0] === " " ? " " : "";

      if (token[0] === "#") {
        const found = ARENAS.find((candidate) => candidate === value);
        if (!found) return match;
        arena = found;
        return leading;
      }
      if (token[0] === "!") {
        const found = PRIORITIES.find((candidate) => candidate === value);
        if (!found) return match;
        priority = found;
        return leading;
      }
      const resolved = resolveDue(value, today);
      if (!resolved) return match;
      due = resolved;
      return leading;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);

  if (!title) return { ok: false, error: "Type something to capture." };
  return { ok: true, capture: { title, arena, priority, due } };
}
