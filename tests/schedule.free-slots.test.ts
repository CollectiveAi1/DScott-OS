import { describe, expect, it } from "vitest";
import type { ProtectedBlock } from "../src/db/schema";
import { startOfDayInstant, zonedTimeToInstant } from "../src/lib/zoned";
import { freeSlots, type BusyEvent } from "../src/modules/schedule/free-slots";

const NY = "America/New_York";

function timed(date: string, start: string, end: string): BusyEvent {
  return {
    startsAt: zonedTimeToInstant(date, start, NY),
    endsAt: zonedTimeToInstant(date, end, NY),
    allDay: false,
  };
}

function allDay(date: string, through = date): BusyEvent {
  return {
    startsAt: startOfDayInstant(date, NY),
    endsAt: startOfDayInstant(nextDay(through), NY),
    allDay: true,
  };
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

const base = { timeZone: NY, protectedTime: [] as ProtectedBlock[], events: [] as BusyEvent[] };

describe("freeSlots", () => {
  it("offers the whole working window on an empty day", () => {
    const slots = freeSlots({ ...base, days: ["2026-11-10"] });
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ date: "2026-11-10", start: "08:00", end: "20:00", minutes: 720 });
  });

  it("splits the window around a timed event", () => {
    const slots = freeSlots({ ...base, days: ["2026-11-10"], events: [timed("2026-11-10", "12:00", "13:00")] });
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([
      ["08:00", "12:00"],
      ["13:00", "20:00"],
    ]);
  });

  it("treats the interval as half-open, so a slot may start the minute an event ends", () => {
    const slots = freeSlots({
      ...base,
      days: ["2026-11-10"],
      events: [timed("2026-11-10", "08:00", "10:00"), timed("2026-11-10", "10:00", "11:00")],
    });
    // Two back-to-back events are one busy block, not two with a zero-length gap between them.
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([["11:00", "20:00"]]);
  });

  it("merges overlapping events rather than counting the overlap twice", () => {
    const slots = freeSlots({
      ...base,
      days: ["2026-11-10"],
      events: [timed("2026-11-10", "09:00", "12:00"), timed("2026-11-10", "10:00", "11:00")],
    });
    // One busy block 09:00–12:00, not two — the nested event adds nothing.
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([
      ["08:00", "09:00"],
      ["12:00", "20:00"],
    ]);
  });

  it("gives nothing on a day an all-day event covers", () => {
    expect(freeSlots({ ...base, days: ["2026-11-10"], events: [allDay("2026-11-10")] })).toEqual([]);
  });

  it("covers every day of a multi-day travel event", () => {
    const slots = freeSlots({
      ...base,
      days: ["2026-11-10", "2026-11-11", "2026-11-12"],
      events: [allDay("2026-11-10", "2026-11-11")],
    });
    expect(slots.map((slot) => slot.date)).toEqual(["2026-11-12"]);
  });

  it("never returns time inside protected time", () => {
    const block: ProtectedBlock = { label: "Family dinner", days: [2], start: "17:00", end: "19:00" };
    const slots = freeSlots({ ...base, days: ["2026-11-10"], protectedTime: [block] });
    // 2026-11-10 is a Tuesday, weekday 2.
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([
      ["08:00", "17:00"],
      ["19:00", "20:00"],
    ]);
  });

  it("applies a protected block only on its own weekdays", () => {
    const block: ProtectedBlock = { label: "Deep work", days: [1], start: "09:00", end: "12:00" };
    const slots = freeSlots({ ...base, days: ["2026-11-10"], protectedTime: [block] });
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([["08:00", "20:00"]]);
  });

  it("drops gaps shorter than the minimum asked for", () => {
    const slots = freeSlots({
      ...base,
      days: ["2026-11-10"],
      events: [timed("2026-11-10", "08:00", "09:00"), timed("2026-11-10", "09:20", "20:00")],
      minimumMinutes: 30,
    });
    expect(slots).toEqual([]);
  });

  it("respects the working-hours bound", () => {
    const slots = freeSlots({ ...base, days: ["2026-11-10"], dayStart: "06:00", dayEnd: "08:00" });
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([["06:00", "08:00"]]);
  });

  it("never offers time that has already gone", () => {
    const slots = freeSlots({
      ...base,
      days: ["2026-11-10"],
      from: zonedTimeToInstant("2026-11-10", "14:30", NY),
    });
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([["14:30", "20:00"]]);
  });

  it("skips a day that is already over", () => {
    const slots = freeSlots({
      ...base,
      days: ["2026-11-10", "2026-11-11"],
      from: zonedTimeToInstant("2026-11-10", "23:00", NY),
    });
    expect(slots.map((slot) => slot.date)).toEqual(["2026-11-11"]);
  });

  it("caps the slots per day", () => {
    const slots = freeSlots({
      ...base,
      days: ["2026-11-10"],
      events: [
        timed("2026-11-10", "09:00", "09:30"),
        timed("2026-11-10", "11:00", "11:30"),
        timed("2026-11-10", "13:00", "13:30"),
        timed("2026-11-10", "15:00", "15:30"),
      ],
      maxPerDay: 2,
    });
    expect(slots.map((slot) => slot.start)).toEqual(["08:00", "09:30"]);
  });

  it("returns real wall times across the spring-forward boundary", () => {
    // 2027-03-14 in New York: the clock jumps 02:00 → 03:00, so the day is 23 hours long.
    const slots = freeSlots({ ...base, days: ["2027-03-14"], dayStart: "01:00", dayEnd: "05:00" });
    expect(slots).toHaveLength(1);
    // Three real hours between 01:00 and 05:00 on that day, and both labels exist.
    expect(slots[0]).toMatchObject({ start: "01:00", end: "05:00", minutes: 180 });
  });

  it("returns real wall times across the fall-back boundary", () => {
    // 2026-11-01 in New York: 01:00–02:00 happens twice, so the day is 25 hours long.
    const slots = freeSlots({ ...base, days: ["2026-11-01"], dayStart: "00:00", dayEnd: "04:00" });
    expect(slots[0]).toMatchObject({ start: "00:00", end: "04:00", minutes: 300 });
  });

  it("returns nothing when asked for a zero-length slot", () => {
    expect(freeSlots({ ...base, days: ["2026-11-10"], minimumMinutes: 0 })).toEqual([]);
  });
});
