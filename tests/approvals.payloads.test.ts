import { describe, expect, it } from "vitest";
import { isDraftable, parsePayload, recipientOf, summarise } from "../src/modules/approvals/payloads";
import { hasRealProvider, noopProvider, providerFor } from "../src/modules/approvals/providers";

const EMAIL = { to: "rosa@example.com", subject: "The pilot", body: "Here is the quote." };
const TEXT = { to: "+16145550142", body: "Running ten minutes late." };
const CALENDAR = {
  calendarId: "devon@example.com",
  event: { title: "Pilot call", startsAt: "2026-11-05T15:00:00.000Z", endsAt: "2026-11-05T16:00:00.000Z" },
};

describe("parsePayload · the kinds v1 can draft", () => {
  it("accepts a well-formed payload of each kind", () => {
    expect(parsePayload("email", EMAIL)).toMatchObject({ ok: true });
    expect(parsePayload("text", TEXT)).toMatchObject({ ok: true });
    expect(parsePayload("calendar_write", CALENDAR)).toMatchObject({ ok: true });
  });

  it("trims what it keeps", () => {
    const result = parsePayload("email", { ...EMAIL, to: "  rosa@example.com  ", subject: " The pilot " });
    expect(result.ok && result.payload).toMatchObject({ to: "rosa@example.com", subject: "The pilot" });
  });
});

describe("parsePayload · refusals", () => {
  it("refuses an empty recipient, subject or body on an email", () => {
    for (const field of ["to", "subject", "body"] as const) {
      expect(parsePayload("email", { ...EMAIL, [field]: "   " }).ok, field).toBe(false);
    }
  });

  it("refuses an address that is not one", () => {
    expect(parsePayload("email", { ...EMAIL, to: "not-an-address" }).ok).toBe(false);
  });

  it("refuses an empty text, and one longer than a text can be", () => {
    expect(parsePayload("text", { ...TEXT, body: "" }).ok).toBe(false);
    expect(parsePayload("text", { ...TEXT, body: "x".repeat(2000) }).ok).toBe(false);
  });

  it("refuses a calendar write with no calendar or an unreadable time", () => {
    expect(parsePayload("calendar_write", { ...CALENDAR, calendarId: "" }).ok).toBe(false);
    expect(
      parsePayload("calendar_write", { ...CALENDAR, event: { ...CALENDAR.event, startsAt: "tomorrow" } }).ok,
    ).toBe(false);
  });

  it("refuses a payload of the wrong shape entirely", () => {
    expect(parsePayload("email", TEXT).ok).toBe(false);
    expect(parsePayload("email", null).ok).toBe(false);
    expect(parsePayload("email", "a string").ok).toBe(false);
  });

  it("refuses the kinds this version cannot draft", () => {
    expect(isDraftable("other")).toBe(false);
    const result = parsePayload("other", { anything: true });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("not something this version can draft");
  });

  it("always explains itself in words, never in zod's", () => {
    for (const bad of [{}, null, { to: "x" }]) {
      const result = parsePayload("email", bad);
      if (result.ok) continue;
      expect(result.error).not.toMatch(/Invalid input|nonoptional|Required/i);
      expect(result.error.endsWith(".")).toBe(true);
    }
  });
});

describe("recipientOf and summarise", () => {
  it("name who it is going to, per kind", () => {
    expect(recipientOf("email", EMAIL)).toBe("rosa@example.com");
    expect(recipientOf("text", TEXT)).toBe("+16145550142");
    expect(recipientOf("calendar_write", CALENDAR)).toBe("devon@example.com");
  });

  it("do not break on a malformed payload", () => {
    expect(recipientOf("email", null)).toBe("—");
    expect(recipientOf("other", {})).toBe("—");
    expect(summarise("email", {})).toContain("(no subject)");
    expect(summarise("calendar_write", {})).toContain("(untitled)");
  });

  it("read as one line", () => {
    expect(summarise("email", EMAIL)).toBe("The pilot → rosa@example.com");
    expect(summarise("calendar_write", CALENDAR)).toBe("Pilot call → devon@example.com");
  });
});

describe("providers in v1", () => {
  it("cannot deliver anything, and says which provider is missing", async () => {
    for (const kind of ["email", "text", "calendar_write"] as const) {
      const result = await providerFor(kind).deliver({ payload: {}, idempotencyKey: "k" });
      expect(result.ok, kind).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/No (email|text|calendar) provider connected\./);
    }
  });

  it("reports that no real provider exists", () => {
    // If this ever flips by accident, going live becomes possible and this test says so first.
    expect(hasRealProvider()).toBe(false);
  });

  it("does not claim idempotency it cannot provide", () => {
    expect(noopProvider("email").supportsIdempotency).toBe(false);
  });
});
