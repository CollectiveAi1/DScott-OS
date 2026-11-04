import { z } from "zod";
import type { FormState } from "@/lib/auth/actions";
import { checkbox, issueToMessage, optionalText, optionalTime } from "@/lib/form-fields";

const ARENA = z.enum(["collective", "basketball", "family", "misc"]);
const KIND = z.enum(["practice", "s_and_c", "team_event", "game", "travel", "family", "deadline", "other"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30.");

export const eventSchema = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(200, "Keep the title under 200 characters."),
  arena: ARENA,
  kind: KIND,
  // An unchecked checkbox sends no field at all, so this key is absent rather than empty.
  allDay: checkbox,
  startDate: DATE,
  // While all-day is on these inputs are not rendered at all, so the key is missing rather than
  // empty. `optionalTime` treats both the same; midnight is the right default for an all-day row.
  startTime: optionalTime.transform((value) => value ?? "00:00"),
  endDate: DATE,
  endTime: optionalTime.transform((value) => value ?? "00:00"),
  location: optionalText,
  notes: optionalText.refine((value) => value === null || value.length <= 5000, "That is a lot of notes."),
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

export const firstIssue = (error: z.ZodError): FormState => issueToMessage(error, FIELD_LABELS);
