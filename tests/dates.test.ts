import { describe, expect, it } from "vitest";
import { addDays, dateInZone, greetingFor } from "../src/lib/dates";

describe("dates", () => {
  it("uses the local calendar day, not UTC", () => {
    // 02:30 UTC on Nov 1 is still Oct 31 in New York.
    const instant = new Date("2026-11-01T02:30:00Z");
    expect(dateInZone(instant, "America/New_York")).toBe("2026-10-31");
    expect(dateInZone(instant, "UTC")).toBe("2026-11-01");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("greets by local hour", () => {
    expect(greetingFor(new Date("2026-11-01T13:00:00Z"), "America/New_York")).toBe("Good morning");
    expect(greetingFor(new Date("2026-11-01T23:00:00Z"), "America/New_York")).toBe("Good evening");
  });
});
