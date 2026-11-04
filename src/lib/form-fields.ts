import { z } from "zod";
import type { FormState } from "./auth/actions";

/**
 * Optional form fields, done once.
 *
 * A browser posts **no key at all** for a control it did not render or an unchecked box — not an
 * empty string. A schema built from `z.string()` therefore fails on exactly the fields the user
 * never saw, which has now caught this codebase three times (M3's all-day checkbox, M3's hidden
 * time inputs, M6's log form). These helpers treat "absent" and "empty" the same, because to the
 * person filling in the form they are the same.
 */
const emptyToNull = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
};

export const optionalText = z.unknown().optional().transform(emptyToNull);

export const optionalDate = z
  .unknown()
  .optional()
  .transform(emptyToNull)
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), "Use a date like 2026-11-30.");

export const optionalTime = z
  .unknown()
  .optional()
  .transform(emptyToNull)
  .refine((value) => value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), "Use a time like 18:00.");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const optionalId = z
  .unknown()
  .optional()
  .transform(emptyToNull)
  .refine((value) => value === null || UUID_PATTERN.test(value), "That record is no longer there.");

/** An unchecked box posts nothing; a checked one posts "on". */
export const checkbox = z
  .unknown()
  .optional()
  .transform((value) => value === "on" || value === "true");

/**
 * Zod's own messages read like "expected nonoptional, received undefined" — written for a
 * developer, and never fit to show Devon (PRD §6.1). A message authored for the form wins;
 * anything left over names the field instead of describing the type system.
 */
export function issueToMessage(error: z.ZodError, labels: Record<string, string> = {}): FormState {
  const issue = error.issues[0];
  if (!issue) return { error: "Check the form." };

  const authored = Boolean(issue.message) && !/^Invalid |^Too |^expected |nonoptional|^Required/i.test(issue.message);
  if (authored) return { error: issue.message };

  const field = labels[String(issue.path[0] ?? "")];
  return { error: field ? `Check the ${field}.` : "Check the form." };
}
