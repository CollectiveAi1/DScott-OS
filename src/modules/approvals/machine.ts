import type { approvalStatusEnum, deliveryModeEnum } from "@/db/schema";

export type ApprovalStatus = (typeof approvalStatusEnum.enumValues)[number];
export type DeliveryMode = (typeof deliveryModeEnum.enumValues)[number];

export type ApprovalEvent =
  | { type: "approve"; mode: DeliveryMode; sendAt?: Date }
  | { type: "reject" }
  | { type: "edit" }
  | { type: "claim" }
  | { type: "delivered" }
  | { type: "failed"; reason: string }
  | { type: "interrupted" }
  | { type: "requeue" };

/** What the row becomes. Only these fields ever change on a transition. */
export type Transition = {
  status: ApprovalStatus;
  mode?: DeliveryMode | null;
  sendAt?: Date | null;
  decidedAt?: Date | null;
  failureReason?: string | null;
};

export type MachineResult = { ok: true; next: Transition } | { ok: false; error: string };

const DECIDED: ApprovalStatus[] = ["sent", "rejected"];

function refuse(status: ApprovalStatus, event: ApprovalEvent): MachineResult {
  if (DECIDED.includes(status)) return { ok: false, error: "That has already been decided." };
  if (status === "sending") return { ok: false, error: "That is being sent right now." };
  return { ok: false, error: `A ${status} approval cannot be ${event.type}ed.` };
}

/**
 * The one place that decides what may happen to an approval next.
 *
 * Pure on purpose: no database, no clock, no side effects, so every path is testable and every
 * caller gets the same answer. Nothing in this codebase may change an approval's status except
 * by asking here first.
 *
 * `now` is passed in rather than read, so a test can prove exactly what gets stamped.
 */
export function transition(status: ApprovalStatus, event: ApprovalEvent, now: Date): MachineResult {
  switch (status) {
    case "waiting":
      switch (event.type) {
        case "approve":
          // Sandbox stops here. It reaches "sent" without any delivery path existing — not a
          // flag checked later, a different branch that ends before a provider is reachable.
          return event.mode === "sandbox"
            ? { ok: true, next: { status: "sent", mode: "sandbox", decidedAt: now, sendAt: null } }
            : { ok: true, next: { status: "scheduled", mode: "live", decidedAt: now, sendAt: event.sendAt ?? now } };
        case "reject":
          return { ok: true, next: { status: "rejected", decidedAt: now } };
        case "edit":
          // An edit keeps it waiting: changing the words is not deciding to send them.
          return { ok: true, next: { status: "waiting" } };
        default:
          return refuse(status, event);
      }

    case "scheduled":
      switch (event.type) {
        case "claim":
          return { ok: true, next: { status: "sending" } };
        case "reject":
          // Beyond PRD §8.8's table, and deliberately: approving something is not the last
          // moment Devon may change his mind. Without this, an approved-but-unsent message
          // could not be stopped, which is the opposite of what this module is for.
          return { ok: true, next: { status: "rejected", decidedAt: now, sendAt: null } };
        default:
          return refuse(status, event);
      }

    case "sending":
      switch (event.type) {
        case "delivered":
          return { ok: true, next: { status: "sent", mode: "live", decidedAt: now, failureReason: null } };
        case "failed":
          return { ok: true, next: { status: "failed", failureReason: event.reason } };
        case "interrupted":
          return { ok: true, next: { status: "failed", failureReason: "interrupted" } };
        default:
          return refuse(status, event);
      }

    case "failed":
      // Back to Devon, not back to the queue: something that failed deserves another look
      // before it is sent again.
      return event.type === "requeue"
        ? { ok: true, next: { status: "waiting", sendAt: null, decidedAt: null, failureReason: null } }
        : refuse(status, event);

    case "sent":
    case "rejected":
      return refuse(status, event);
  }
}

/** Whether Devon can still act on a row, for deciding which controls a card shows. */
export function isOpen(status: ApprovalStatus): boolean {
  return status === "waiting" || status === "scheduled" || status === "failed";
}
