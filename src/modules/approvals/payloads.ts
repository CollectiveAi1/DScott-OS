import { z } from "zod";
import type { approvalKindEnum } from "@/db/schema";

export type ApprovalKind = (typeof approvalKindEnum.enumValues)[number];

/** Kinds v1 can actually draft. `other` is in the enum for later and is refused at creation. */
export const DRAFTABLE_KINDS = ["email", "text", "calendar_write"] as const;
export type DraftableKind = (typeof DRAFTABLE_KINDS)[number];

const nonEmpty = (label: string) => z.string().trim().min(1, `${label} cannot be empty.`);

export const emailPayload = z.object({
  to: nonEmpty("A recipient").email("That is not an email address."),
  subject: nonEmpty("A subject").max(300, "That subject is very long."),
  body: nonEmpty("A message").max(20_000, "That message is very long."),
});

export const textPayload = z.object({
  // Deliberately loose: a phone number's shape is a provider's business, not this module's.
  to: nonEmpty("A number").max(40),
  body: nonEmpty("A message").max(1600, "A text cannot be that long."),
});

export const calendarWritePayload = z.object({
  calendarId: nonEmpty("A calendar"),
  event: z.object({
    title: nonEmpty("A title").max(200),
    startsAt: z.string().datetime({ message: "Use an ISO timestamp." }),
    endsAt: z.string().datetime({ message: "Use an ISO timestamp." }),
    allDay: z.boolean().optional(),
    location: z.string().max(300).optional(),
    notes: z.string().max(5000).optional(),
  }),
});

const SCHEMAS = {
  email: emailPayload,
  text: textPayload,
  calendar_write: calendarWritePayload,
} as const;

export type EmailPayload = z.infer<typeof emailPayload>;
export type TextPayload = z.infer<typeof textPayload>;
export type CalendarWritePayload = z.infer<typeof calendarWritePayload>;
export type ApprovalPayload = EmailPayload | TextPayload | CalendarWritePayload;

export type PayloadResult = { ok: true; payload: ApprovalPayload } | { ok: false; error: string };

export function isDraftable(kind: string): kind is DraftableKind {
  return (DRAFTABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * A payload, checked against the shape its kind requires.
 *
 * Nothing reaches the database unvalidated. An approval is a message to a person; a payload
 * that nobody checked is how a draft with an empty recipient or a missing body gets as far as a
 * provider.
 */
export function parsePayload(kind: string, payload: unknown): PayloadResult {
  if (!isDraftable(kind)) {
    return { ok: false, error: "That kind of approval is not something this version can draft." };
  }
  const parsed = SCHEMAS[kind].safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const authored = issue?.message && !/^Invalid |^Required|^expected |nonoptional/i.test(issue.message);
    return { ok: false, error: authored ? issue.message : `That ${kind.replace("_", " ")} is missing something.` };
  }
  return { ok: true, payload: parsed.data };
}

/** Who it is addressed to, for showing on a card without the screen knowing each kind's shape. */
export function recipientOf(kind: string, payload: unknown): string {
  const record = (payload ?? {}) as Record<string, unknown>;
  if (kind === "email" || kind === "text") return typeof record.to === "string" ? record.to : "—";
  if (kind === "calendar_write") return typeof record.calendarId === "string" ? record.calendarId : "—";
  return "—";
}

/** A one-line description, for lists and timeline rows. */
export function summarise(kind: string, payload: unknown): string {
  const record = (payload ?? {}) as Record<string, unknown>;
  if (kind === "email") return `${String(record.subject ?? "(no subject)")} → ${recipientOf(kind, payload)}`;
  if (kind === "text") return `Text → ${recipientOf(kind, payload)}`;
  if (kind === "calendar_write") {
    const event = (record.event ?? {}) as Record<string, unknown>;
    return `${String(event.title ?? "(untitled)")} → ${recipientOf(kind, payload)}`;
  }
  return kind;
}
