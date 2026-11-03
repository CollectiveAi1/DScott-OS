import { describe, expect, it } from "vitest";
import {
  dayGrid,
  instantToZonedParts,
  monthGrid,
  startOfDayInstant,
  weekGrid,
  zonedTimeToInstant,
} from "../src/lib/zoned";

const NY = "America/New_York";
const KOLKATA = "Asia/Kolkata";

describe("zonedTimeToInstant", () => {
  it("reads a winter wall time as EST (UTC−5)", () => {
    expect(zonedTimeToInstant("2026-01-15", "09:30", NY).toISOString()).toBe("2026-01-15T14:30:00.000Z");
  });

  it("reads a summer wall time as EDT (UTC−4)", () => {
    expect(zonedTimeToInstant("2026-07-15", "09:30", NY).toISOString()).toBe("2026-07-15T13:30:00.000Z");
  });

  it("handles UTC and a half-hour offset", () => {
    expect(zonedTimeToInstant("2026-03-01", "12:00", "UTC").toISOString()).toBe("2026-03-01T12:00:00.000Z");
    // Kolkata is UTC+5:30 all year.
    expect(zonedTimeToInstant("2026-03-01", "12:00", KOLKATA).toISOString()).toBe("2026-03-01T06:30:00.000Z");
  });

  it("round-trips every hour of a normal day", () => {
    for (let hour = 0; hour < 24; hour++) {
      const time = `${String(hour).padStart(2, "0")}:15`;
      const instant = zonedTimeToInstant("2026-06-10", time, NY);
      expect(instantToZonedParts(instant, NY)).toEqual({ date: "2026-06-10", time });
    }
  });

  it("round-trips across both DST boundaries, skipping the hour that does not exist", () => {
    // 2026-03-08 is spring forward: 02:00 → 03:00. Every other hour round-trips.
    for (let hour = 0; hour < 24; hour++) {
      if (hour === 2) continue;
      const time = `${String(hour).padStart(2, "0")}:45`;
      const instant = zonedTimeToInstant("2026-03-08", time, NY);
      expect(instantToZonedParts(instant, NY), `03-08 ${time}`).toEqual({ date: "2026-03-08", time });
    }
  });

  it("lands just after the gap for a wall time that does not exist", () => {
    // 02:30 on 2026-03-08 never happens in New York; the clock goes 01:59 → 03:00.
    const instant = zonedTimeToInstant("2026-03-08", "02:30", NY);
    expect(instant.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(instantToZonedParts(instant, NY)).toEqual({ date: "2026-03-08", time: "03:30" });
  });

  it("picks the first of a wall time that happens twice", () => {
    // 01:30 on 2026-11-01 happens in EDT and again in EST. The spec takes the earlier one.
    const instant = zonedTimeToInstant("2026-11-01", "01:30", NY);
    expect(instant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(instantToZonedParts(instant, NY).time).toBe("01:30");
  });
});

describe("startOfDayInstant", () => {
  it("is local midnight, not UTC midnight", () => {
    expect(startOfDayInstant("2026-11-02", NY).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(startOfDayInstant("2026-07-02", NY).toISOString()).toBe("2026-07-02T04:00:00.000Z");
  });

  it("is still midnight on the day the clocks change", () => {
    expect(instantToZonedParts(startOfDayInstant("2026-03-08", NY), NY).time).toBe("00:00");
    expect(instantToZonedParts(startOfDayInstant("2026-11-01", NY), NY).time).toBe("00:00");
  });
});

describe("dayGrid", () => {
  it("covers exactly one local day", () => {
    const grid = dayGrid("2026-11-02", NY);
    expect(grid.days).toEqual(["2026-11-02"]);
    expect(grid.from.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(grid.to.toISOString()).toBe("2026-11-03T05:00:00.000Z");
  });

  it("is 23 hours long on the spring-forward day and 25 on the fall-back day", () => {
    const spring = dayGrid("2026-03-08", NY);
    expect((spring.to.getTime() - spring.from.getTime()) / 3_600_000).toBe(23);
    const fall = dayGrid("2026-11-01", NY);
    expect((fall.to.getTime() - fall.from.getTime()) / 3_600_000).toBe(25);
  });
});

describe("weekGrid", () => {
  it("starts on the Monday on or before the given date", () => {
    // 2026-11-04 is a Wednesday.
    expect(weekGrid("2026-11-04", NY).days).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("treats a Monday as its own week start and a Sunday as the end of one", () => {
    expect(weekGrid("2026-11-02", NY).days[0]).toBe("2026-11-02");
    expect(weekGrid("2026-11-08", NY).days[0]).toBe("2026-11-02");
  });

  it("still has exactly seven days across both DST boundaries", () => {
    for (const date of ["2026-03-08", "2026-11-01"]) {
      expect(weekGrid(date, NY).days).toHaveLength(7);
    }
  });
});

describe("monthGrid", () => {
  it("is always 42 cells, six weeks, starting on a Monday", () => {
    for (const date of ["2026-11-15", "2026-02-10", "2024-02-10", "2026-03-20", "2027-01-01"]) {
      const grid = monthGrid(date, NY);
      expect(grid.days, date).toHaveLength(42);
      expect(grid.days[0], date).toBe(grid.weeks[0]?.[0]);
      expect(grid.weeks, date).toHaveLength(6);
      expect(grid.weeks.every((week) => week.length === 7), date).toBe(true);
    }
  });

  it("starts on the Monday on or before the 1st and covers the whole month", () => {
    // November 2026 starts on a Sunday, so the grid opens on Monday 2026-10-26.
    const november = monthGrid("2026-11-15", NY);
    expect(november.days[0]).toBe("2026-10-26");
    expect(november.days).toContain("2026-11-01");
    expect(november.days).toContain("2026-11-30");
    expect(november.month).toBe("2026-11");
  });

  it("covers a 28-day February and a leap February", () => {
    const short = monthGrid("2026-02-10", NY);
    expect(short.days).toContain("2026-02-28");
    expect(short.days).not.toContain("2026-02-29");

    const leap = monthGrid("2024-02-10", NY);
    expect(leap.days).toContain("2024-02-29");
  });

  it("spans from local midnight on the first cell to local midnight after the last", () => {
    const grid = monthGrid("2026-11-15", NY);
    expect(grid.from.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    // The grid's last day is 2026-12-06; it ends at midnight on the 7th, after DST ended.
    expect(grid.to.toISOString()).toBe("2026-12-07T05:00:00.000Z");
  });

  it("marks which cells belong to the month being shown", () => {
    const grid = monthGrid("2026-11-15", NY);
    expect(grid.inMonth("2026-10-26")).toBe(false);
    expect(grid.inMonth("2026-11-01")).toBe(true);
    expect(grid.inMonth("2026-12-01")).toBe(false);
  });
});
