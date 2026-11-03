import { z } from "zod";
import type { ProtectedBlock } from "@/db/schema";
import { minutesOfDay } from "./dates";

export const MAX_PROTECTED_BLOCKS = 10;

export const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
] as const;

/** Every IANA zone this runtime knows. Used to build the select and to validate what comes back. */
export function supportedTimeZones(): string[] {
  return [...Intl.supportedValuesOf("timeZone")];
}

export function isSupportedTimeZone(value: unknown): value is string {
  return typeof value === "string" && supportedTimeZones().includes(value);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const blockSchema = z.object({
  label: z.string().trim().min(1, "Give the block a label.").max(40, "Keep the label under 40 characters."),
  days: z
    .array(z.coerce.number().int().min(1).max(7))
    .min(1, "Pick at least one day.")
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  start: z.string().regex(HHMM, "Start must be a time like 18:00."),
  end: z.string().regex(HHMM, "End must be a time like 21:00."),
});

export type BlockResult =
  | { ok: true; block: ProtectedBlock }
  | { ok: false; message: string };

/**
 * Validates one protected-time block. Pure, so the rule is tested without a form or a database.
 * `existing` is the current block count: the cap is part of the rule, not of the UI.
 */
export function parseProtectedBlock(input: unknown, existingCount: number): BlockResult {
  if (existingCount >= MAX_PROTECTED_BLOCKS) {
    return { ok: false, message: `You already have ${MAX_PROTECTED_BLOCKS} blocks. Remove one first.` };
  }
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the block." };

  const { label, days, start, end } = parsed.data;
  if (minutesOfDay(end) <= minutesOfDay(start)) {
    return { ok: false, message: "End has to be after start. A block cannot cross midnight; add two." };
  }
  return { ok: true, block: { label, days, start, end } };
}

export function describeDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join() === "1,2,3,4,5") return "Weekdays";
  if (sorted.join() === "6,7") return "Weekends";
  return sorted.map((day) => WEEKDAYS[day - 1]?.short ?? "?").join(", ");
}
