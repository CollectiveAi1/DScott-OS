import { describe, expect, it } from "vitest";
import { describeSchedule, isJobDue, type JobSchedule } from "../src/modules/jobs/schedule";

const ZONE = "America/New_York";
const interval: JobSchedule = { kind: "interval", everyMinutes: 10 };
const daily: JobSchedule = { kind: "dailyAfter", time: "06:30" };
const weekly: JobSchedule = { kind: "weeklyAfter", weekday: 7, time: "18:00" };

describe("isJobDue · interval", () => {
  const now = new Date("2026-11-02T15:00:00Z");

  it("runs when it has never run", () => {
    expect(isJobDue(interval, null, now, ZONE)).toBe(true);
  });

  it("waits inside the window", () => {
    expect(isJobDue(interval, new Date("2026-11-02T14:56:00Z"), now, ZONE)).toBe(false);
  });

  it("runs past the window", () => {
    expect(isJobDue(interval, new Date("2026-11-02T14:48:00Z"), now, ZONE)).toBe(true);
  });

  it("allows a minute of cron drift so a 10-min job is not deferred a whole tick", () => {
    // 9 min 58 s elapsed: a 5-minute cron would otherwise push this to 14 min 58 s.
    expect(isJobDue(interval, new Date("2026-11-02T14:50:02Z"), now, ZONE)).toBe(true);
    expect(isJobDue(interval, new Date("2026-11-02T14:51:30Z"), now, ZONE)).toBe(false);
  });
});

describe("isJobDue · dailyAfter", () => {
  // 11:00 UTC is 06:00 in New York (EST), 12:00 UTC is 07:00.
  const before = new Date("2026-11-02T11:00:00Z");
  const after = new Date("2026-11-02T12:00:00Z");

  it("waits until the local time passes", () => {
    expect(isJobDue(daily, null, before, ZONE)).toBe(false);
    expect(isJobDue(daily, null, after, ZONE)).toBe(true);
  });

  it("runs once per local day", () => {
    expect(isJobDue(daily, new Date("2026-11-02T11:45:00Z"), after, ZONE)).toBe(false);
    expect(isJobDue(daily, new Date("2026-11-01T11:45:00Z"), after, ZONE)).toBe(true);
  });

  it("uses the local day, not UTC", () => {
    // 01:00 UTC Nov 3 is still 20:00 Nov 2 in New York: same local day, already ran.
    const lateLocal = new Date("2026-11-03T01:00:00Z");
    expect(isJobDue(daily, new Date("2026-11-02T12:00:00Z"), lateLocal, ZONE)).toBe(false);
  });

  it("is unaffected by the DST change", () => {
    // DST ended 2026-11-01 at 02:00 local; 11:30 UTC is 06:30 EST, exactly the threshold.
    expect(isJobDue(daily, null, new Date("2026-11-01T11:30:00Z"), ZONE)).toBe(true);
    // The day before, 11:30 UTC was 07:30 EDT: also past, and the previous day's run is stale.
    expect(isJobDue(daily, new Date("2026-10-30T10:30:00Z"), new Date("2026-10-31T10:30:00Z"), ZONE)).toBe(true);
  });
});

describe("isJobDue · weeklyAfter", () => {
  // 2026-11-01 is a Sunday; 2026-11-02 is a Monday. 23:00 UTC is 18:00 EST.
  const sundayEvening = new Date("2026-11-01T23:00:00Z");

  it("runs on the right weekday after the time", () => {
    expect(isJobDue(weekly, null, sundayEvening, ZONE)).toBe(true);
    expect(isJobDue(weekly, null, new Date("2026-11-01T20:00:00Z"), ZONE)).toBe(false);
  });

  it("does not run on another weekday", () => {
    expect(isJobDue(weekly, null, new Date("2026-11-02T23:00:00Z"), ZONE)).toBe(false);
  });

  it("runs once per Sunday", () => {
    expect(isJobDue(weekly, new Date("2026-11-01T23:05:00Z"), new Date("2026-11-01T23:30:00Z"), ZONE)).toBe(false);
    expect(isJobDue(weekly, new Date("2026-10-25T23:05:00Z"), sundayEvening, ZONE)).toBe(true);
  });
});

describe("describeSchedule", () => {
  it("reads as a sentence for Devon", () => {
    expect(describeSchedule(interval)).toBe("Every 10 min");
    expect(describeSchedule(daily)).toBe("Daily after 06:30");
    expect(describeSchedule(weekly)).toBe("Sun after 18:00");
  });
});
