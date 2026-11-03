import { describe, expect, it } from "vitest";
import {
  describeDays,
  isSupportedTimeZone,
  MAX_PROTECTED_BLOCKS,
  parseProtectedBlock,
  supportedTimeZones,
} from "../src/lib/settings-rules";

const valid = { label: "Family dinner", days: ["2", "4"], start: "18:00", end: "19:30" };

describe("time zones", () => {
  it("accepts a real IANA zone and refuses anything else", () => {
    expect(isSupportedTimeZone("America/New_York")).toBe(true);
    expect(isSupportedTimeZone("Europe/Berlin")).toBe(true);
    expect(isSupportedTimeZone("Mars/Olympus")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone(undefined)).toBe(false);
    expect(isSupportedTimeZone("'; drop table settings; --")).toBe(false);
  });

  it("offers a list that includes Devon's zone", () => {
    expect(supportedTimeZones()).toContain("America/New_York");
    expect(supportedTimeZones().length).toBeGreaterThan(100);
  });
});

describe("parseProtectedBlock", () => {
  it("accepts a well-formed block and normalises the days", () => {
    const result = parseProtectedBlock({ ...valid, days: ["4", "2", "2"] }, 0);
    expect(result).toEqual({ ok: true, block: { label: "Family dinner", days: [2, 4], start: "18:00", end: "19:30" } });
  });

  it("refuses an end at or before the start", () => {
    expect(parseProtectedBlock({ ...valid, end: "18:00" }, 0)).toMatchObject({ ok: false });
    expect(parseProtectedBlock({ ...valid, end: "17:00" }, 0)).toMatchObject({
      ok: false,
      message: expect.stringContaining("after start"),
    });
  });

  it("refuses a blank label, no days and a malformed time", () => {
    expect(parseProtectedBlock({ ...valid, label: "   " }, 0)).toMatchObject({ ok: false });
    expect(parseProtectedBlock({ ...valid, days: [] }, 0)).toMatchObject({ ok: false });
    expect(parseProtectedBlock({ ...valid, start: "6pm" }, 0)).toMatchObject({ ok: false });
    expect(parseProtectedBlock({ ...valid, start: "25:00" }, 0)).toMatchObject({ ok: false });
    expect(parseProtectedBlock({ ...valid, days: ["0"] }, 0)).toMatchObject({ ok: false });
    expect(parseProtectedBlock({ ...valid, days: ["8"] }, 0)).toMatchObject({ ok: false });
  });

  it("trims the label and caps its length", () => {
    expect(parseProtectedBlock({ ...valid, label: "  Practice  " }, 0)).toMatchObject({
      ok: true,
      block: { label: "Practice" },
    });
    expect(parseProtectedBlock({ ...valid, label: "x".repeat(41) }, 0)).toMatchObject({ ok: false });
  });

  it("enforces the block cap as a rule, not just in the UI", () => {
    expect(parseProtectedBlock(valid, MAX_PROTECTED_BLOCKS - 1)).toMatchObject({ ok: true });
    expect(parseProtectedBlock(valid, MAX_PROTECTED_BLOCKS)).toMatchObject({
      ok: false,
      message: expect.stringContaining("Remove one first"),
    });
  });
});

describe("describeDays", () => {
  it("reads the way Devon would say it", () => {
    expect(describeDays([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(describeDays([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(describeDays([6, 7])).toBe("Weekends");
    expect(describeDays([4, 2])).toBe("Tue, Thu");
  });
});
