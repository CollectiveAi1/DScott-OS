import { describe, expect, it } from "vitest";
import { eventSchema, firstIssue } from "../src/modules/schedule/form-schema";

/** What the browser actually posts: an unchecked checkbox sends no field at all. */
function posted(overrides: Record<string, string> = {}, omit: string[] = []) {
  const form = new FormData();
  const base: Record<string, string> = {
    title: "Kinetic pilot call",
    arena: "collective",
    kind: "other",
    allDay: "on",
    startDate: "2026-11-04",
    startTime: "18:00",
    endDate: "2026-11-04",
    endTime: "19:00",
    location: "",
    notes: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(base)) {
    if (!omit.includes(key)) form.set(key, value);
  }
  return Object.fromEntries(form);
}

describe("eventSchema", () => {
  it("accepts a timed event with the all-day box unchecked", () => {
    // The regression: an unchecked box omits the key, which must not be a validation failure.
    const parsed = eventSchema.safeParse(posted({}, ["allDay"]));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.allDay).toBe(false);
  });

  it("reads a checked all-day box", () => {
    expect(eventSchema.safeParse(posted({ allDay: "on" })).success).toBe(true);
    const parsed = eventSchema.safeParse(posted({ allDay: "on" }));
    expect(parsed.success && parsed.data.allDay).toBe(true);
  });

  it("does not treat a stray all-day value as checked", () => {
    const parsed = eventSchema.safeParse(posted({ allDay: "off" }));
    expect(parsed.success && parsed.data.allDay).toBe(false);
  });

  it("fills in empty times", () => {
    const parsed = eventSchema.safeParse(posted({ allDay: "on", startTime: "", endTime: "" }));
    expect(parsed.success && parsed.data.startTime).toBe("00:00");
    expect(parsed.success && parsed.data.endTime).toBe("00:00");
  });

  it("accepts an all-day event whose time inputs were never rendered", () => {
    // The form removes the time fields while all-day is on, so the browser posts no key at all.
    const parsed = eventSchema.safeParse(posted({ allDay: "on" }, ["startTime", "endTime"]));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.startTime).toBe("00:00");
  });

  it("turns empty optional fields into null rather than empty strings", () => {
    const parsed = eventSchema.safeParse(posted());
    expect(parsed.success && parsed.data.location).toBeNull();
    expect(parsed.success && parsed.data.notes).toBeNull();
  });

  it("refuses a blank title, a bad date, a bad time and an unknown arena or kind", () => {
    expect(eventSchema.safeParse(posted({ title: "   " })).success).toBe(false);
    expect(eventSchema.safeParse(posted({ startDate: "04/11/2026" })).success).toBe(false);
    expect(eventSchema.safeParse(posted({ startTime: "6pm" })).success).toBe(false);
    expect(eventSchema.safeParse(posted({ arena: "work" })).success).toBe(false);
    expect(eventSchema.safeParse(posted({ kind: "brunch" })).success).toBe(false);
  });
});

describe("firstIssue · messages are for Devon, not for developers", () => {
  it("passes through a message written for this form", () => {
    const parsed = eventSchema.safeParse(posted({ title: "" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(firstIssue(parsed.error).error).toBe("Give it a title.");
  });

  it("names the field instead of leaking zod's own wording", () => {
    const parsed = eventSchema.safeParse(posted({}, ["arena"]));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const message = firstIssue(parsed.error).error ?? "";
      expect(message).toBe("Check the arena.");
      expect(message).not.toMatch(/nonoptional|undefined|Invalid input/i);
    }
  });

  it("never shows a raw zod message for any single missing field", () => {
    for (const field of ["title", "arena", "kind", "startDate", "endDate"]) {
      const parsed = eventSchema.safeParse(posted({}, [field]));
      if (parsed.success) continue;
      const message = firstIssue(parsed.error).error ?? "";
      expect(message, field).not.toMatch(/nonoptional|received undefined|Invalid input/i);
      expect(message.endsWith("."), field).toBe(true);
    }
  });
});
