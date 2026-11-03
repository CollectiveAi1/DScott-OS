import { z } from "zod";
import type { FormState } from "@/lib/auth/actions";

const ARENA = z.enum(["collective", "basketball", "family", "misc"]);
const KIND = z.enum(["practice", "s_and_c", "team_event", "game", "travel", "family", "deadline", "other"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30.");
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 18:00.");

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

export const eventSchema = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(200, "Keep the title under 200 characters."),
  arena: ARENA,
  kind: KIND,
  // An unchecked checkbox sends no field at all, so this key is absent rather than empty.
  allDay: z.unknown().optional().transform((value) => value === "on" || value === "true"),
  startDate: DATE,
  // While all-day is on these inputs are not rendered at all, so the key is missing rather than
  // empty. Both have to be tolerated: a browser posts neither for a control that is not there.
  startTime: z.union([TIME, z.literal("")]).optional().transform((value) => value || "00:00"),
  endDate: DATE,
  endTime: z.union([TIME, z.literal("")]).optional().transform((value) => value || "00:00"),
  location: optionalText,
  notes: optionalText.pipe(z.string().max(5000, "That is a lot of notes.").nullable()),
});

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  arena: "arena",
  kind: "kind",
  startDate: "start date",
  startTime: "start time",
  endDate: "end date",
  endTime: "end time",
  location: "location",
  notes: "notes",
  a: "event",
  b: "event",
  id: "event",
};

/**
 * Zod's own messages read like "expected nonoptional, received undefined". Those are written for
 * developers. A message authored for this form always wins; anything left over names the field
 * rather than describing the type system (PRD §6.1).
 */
export function firstIssue(error: z.ZodError): FormState {
  const issue = error.issues[0];
  if (!issue) return { error: "Check the form." };

  const authored = Boolean(issue.message) && !/^Invalid |^Too |^expected |nonoptional/i.test(issue.message);
  if (authored) return { error: issue.message };

  const field = FIELD_LABELS[String(issue.path[0] ?? "")];
  return { error: field ? `Check the ${field}.` : "Check the form." };
}
