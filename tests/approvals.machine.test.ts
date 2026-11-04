import { describe, expect, it } from "vitest";
import { isOpen, transition, type ApprovalEvent, type ApprovalStatus } from "../src/modules/approvals/machine";

const NOW = new Date("2026-11-04T15:00:00Z");

const ALL_STATUSES: ApprovalStatus[] = ["waiting", "scheduled", "sending", "sent", "failed", "rejected"];
const ALL_EVENTS: ApprovalEvent[] = [
  { type: "approve", mode: "sandbox" },
  { type: "approve", mode: "live" },
  { type: "reject" },
  { type: "edit" },
  { type: "claim" },
  { type: "delivered" },
  { type: "failed", reason: "boom" },
  { type: "interrupted" },
  { type: "requeue" },
];

/** Every move SPEC-008 §2 allows. Anything not here must be refused. */
const ALLOWED = new Set([
  "waiting:approve-sandbox",
  "waiting:approve-live",
  "waiting:reject",
  "waiting:edit",
  "scheduled:claim",
  "scheduled:reject",
  "sending:delivered",
  "sending:failed",
  "sending:interrupted",
  "failed:requeue",
]);

const key = (status: ApprovalStatus, event: ApprovalEvent) =>
  `${status}:${event.type === "approve" ? `approve-${event.mode}` : event.type}`;

describe("the whole table", () => {
  it("allows exactly the transitions in the spec and refuses every other combination", () => {
    for (const status of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        const result = transition(status, event, NOW);
        expect(result.ok, key(status, event)).toBe(ALLOWED.has(key(status, event)));
      }
    }
  });

  it("never throws, whatever it is given", () => {
    for (const status of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        expect(() => transition(status, event, NOW)).not.toThrow();
      }
    }
  });

  it("explains every refusal rather than returning a bare false", () => {
    for (const status of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        const result = transition(status, event, NOW);
        if (result.ok) continue;
        expect(result.error.length, key(status, event)).toBeGreaterThan(10);
        expect(result.error.endsWith("."), key(status, event)).toBe(true);
      }
    }
  });
});

describe("approving", () => {
  it("in sandbox goes straight to sent, with nothing scheduled", () => {
    const result = transition("waiting", { type: "approve", mode: "sandbox" }, NOW);
    expect(result).toEqual({
      ok: true,
      next: { status: "sent", mode: "sandbox", decidedAt: NOW, sendAt: null },
    });
  });

  it("in live schedules it for now by default", () => {
    const result = transition("waiting", { type: "approve", mode: "live" }, NOW);
    expect(result.ok && result.next).toEqual({ status: "scheduled", mode: "live", decidedAt: NOW, sendAt: NOW });
  });

  it("in live honours a chosen time", () => {
    const later = new Date("2026-11-05T09:00:00Z");
    const result = transition("waiting", { type: "approve", mode: "live", sendAt: later }, NOW);
    expect(result.ok && result.next.sendAt).toEqual(later);
  });

  it("a second time is refused with 'already decided'", () => {
    // PRD §8.8's acceptance criterion: a double submit makes one transition.
    const first = transition("waiting", { type: "approve", mode: "sandbox" }, NOW);
    expect(first.ok).toBe(true);
    const second = transition("sent", { type: "approve", mode: "sandbox" }, NOW);
    expect(second).toEqual({ ok: false, error: "That has already been decided." });
  });
});

describe("rejecting", () => {
  it("works from waiting", () => {
    expect(transition("waiting", { type: "reject" }, NOW).ok).toBe(true);
  });

  it("works from scheduled, so an approved message can still be stopped", () => {
    const result = transition("scheduled", { type: "reject" }, NOW);
    expect(result.ok && result.next).toEqual({ status: "rejected", decidedAt: NOW, sendAt: null });
  });

  it("does not work once the row has been claimed", () => {
    expect(transition("sending", { type: "reject" }, NOW)).toEqual({
      ok: false,
      error: "That is being sent right now.",
    });
  });

  it("does not work on something already sent", () => {
    expect(transition("sent", { type: "reject" }, NOW).ok).toBe(false);
  });
});

describe("editing", () => {
  it("leaves it waiting: changing the words is not deciding to send them", () => {
    expect(transition("waiting", { type: "edit" }, NOW)).toEqual({ ok: true, next: { status: "waiting" } });
  });

  it("is refused once it is scheduled, sent or rejected", () => {
    for (const status of ["scheduled", "sending", "sent", "rejected"] as ApprovalStatus[]) {
      expect(transition(status, { type: "edit" }, NOW).ok, status).toBe(false);
    }
  });
});

describe("delivery", () => {
  it("claims a scheduled row into sending", () => {
    expect(transition("scheduled", { type: "claim" }, NOW).ok && transition("scheduled", { type: "claim" }, NOW)).toMatchObject({
      next: { status: "sending" },
    });
  });

  it("cannot claim the same row twice", () => {
    expect(transition("sending", { type: "claim" }, NOW).ok).toBe(false);
  });

  it("records a success as sent and clears any old failure", () => {
    const result = transition("sending", { type: "delivered" }, NOW);
    expect(result.ok && result.next).toEqual({ status: "sent", mode: "live", decidedAt: NOW, failureReason: null });
  });

  it("records a failure with its reason", () => {
    const result = transition("sending", { type: "failed", reason: "No email provider connected" }, NOW);
    expect(result.ok && result.next).toEqual({ status: "failed", failureReason: "No email provider connected" });
  });

  it("records an interrupted send as failed, by that name", () => {
    const result = transition("sending", { type: "interrupted" }, NOW);
    expect(result.ok && result.next).toEqual({ status: "failed", failureReason: "interrupted" });
  });

  it("will not deliver something that was never claimed", () => {
    expect(transition("scheduled", { type: "delivered" }, NOW).ok).toBe(false);
    expect(transition("waiting", { type: "delivered" }, NOW).ok).toBe(false);
  });
});

describe("requeuing", () => {
  it("sends a failed row back to Devon, not back to the queue", () => {
    const result = transition("failed", { type: "requeue" }, NOW);
    expect(result.ok && result.next).toEqual({
      status: "waiting",
      sendAt: null,
      decidedAt: null,
      failureReason: null,
    });
  });

  it("is refused for anything that has not failed", () => {
    for (const status of ["waiting", "scheduled", "sending", "sent", "rejected"] as ApprovalStatus[]) {
      expect(transition(status, { type: "requeue" }, NOW).ok, status).toBe(false);
    }
  });
});

describe("isOpen", () => {
  it("is true only while Devon can still act", () => {
    expect(ALL_STATUSES.filter(isOpen)).toEqual(["waiting", "scheduled", "failed"]);
  });
});
