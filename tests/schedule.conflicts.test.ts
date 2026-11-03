import { describe, expect, it } from "vitest";
import type { ProtectedBlock } from "../src/db/schema";
import { weekdayOf } from "../src/lib/dates";
import { zonedTimeToInstant } from "../src/lib/zoned";
import {
  eventsConflict,
  findConflictPairs,
  overlaps,
  pairKey,
  protectedConflicts,
  type ConflictEvent,
} from "../src/modules/schedule/conflicts";

const NY = "America/New_York";
let nextId = 0;

function timed(
  arena: string,
  date: string,
  start: string,
  end: string,
  extra: Partial<ConflictEvent> = {},
): ConflictEvent {
  return {
    id: `t${++nextId}`,
    title: `${arena} ${start}`,
    arena,
    kind: "other",
    startsAt: zonedTimeToInstant(date, start, NY),
    endsAt: zonedTimeToInstant(date, end, NY),
    allDay: false,
    ...extra,
  };
}

/** All-day is midnight to exclusive midnight: Nov 5–7 ends at Nov 8 00:00. */
function allDay(arena: string, from: string, throughExclusive: string, kind = "other"): ConflictEvent {
  return {
    id: `a${++nextId}`,
    title: `${arena} all-day`,
    arena,
    kind,
    startsAt: zonedTimeToInstant(from, "00:00", NY),
    endsAt: zonedTimeToInstant(throughExclusive, "00:00", NY),
    allDay: true,
  };
}

const DAY = "2026-11-04";

describe("overlaps · half-open intervals", () => {
  it("does not count back-to-back events as overlapping", () => {
    const first = timed("collective", DAY, "10:00", "11:00");
    const second = timed("collective", DAY, "11:00", "12:00");
    expect(overlaps(first, second)).toBe(false);
    expect(eventsConflict(first, second)).toBe(false);
  });

  it("counts a partial overlap, a contained event and an identical one", () => {
    const base = timed("collective", DAY, "10:00", "12:00");
    expect(overlaps(base, timed("collective", DAY, "11:00", "13:00"))).toBe(true);
    expect(overlaps(base, timed("collective", DAY, "10:30", "11:00"))).toBe(true);
    expect(overlaps(base, timed("collective", DAY, "10:00", "12:00"))).toBe(true);
  });
});

describe("eventsConflict · the rule table in SPEC-003 §3", () => {
  it("rule 1 · no overlap, no conflict", () => {
    expect(eventsConflict(timed("collective", DAY, "09:00", "10:00"), timed("basketball", DAY, "14:00", "16:00"))).toBe(
      false,
    );
  });

  it("rule 2 · two all-day events do not conflict", () => {
    expect(eventsConflict(allDay("family", DAY, "2026-11-05"), allDay("collective", DAY, "2026-11-05"))).toBe(false);
  });

  it("rule 3 · two overlapping basketball events do not conflict", () => {
    // A practice inside a team event is normal.
    expect(
      eventsConflict(timed("basketball", DAY, "17:00", "21:00"), timed("basketball", DAY, "18:00", "19:30")),
    ).toBe(false);
  });

  it("rule 3 is basketball only · two Collective meetings do conflict", () => {
    expect(eventsConflict(timed("collective", DAY, "10:00", "11:00"), timed("collective", DAY, "10:30", "11:30"))).toBe(
      true,
    );
  });

  it("rule 4 · all-day basketball travel conflicts with a timed event in another arena", () => {
    const travel = allDay("basketball", "2026-11-03", "2026-11-06", "travel");
    expect(eventsConflict(travel, timed("collective", DAY, "10:00", "11:00"))).toBe(true);
    expect(eventsConflict(travel, timed("family", DAY, "18:00", "20:00"))).toBe(true);
  });

  it("rule 4 defers to rule 3 · travel does not conflict with a basketball practice", () => {
    const travel = allDay("basketball", "2026-11-03", "2026-11-06", "travel");
    expect(eventsConflict(travel, timed("basketball", DAY, "17:00", "19:00"))).toBe(false);
  });

  it("rule 4 · travel does not reach a timed event outside its days", () => {
    const travel = allDay("basketball", "2026-11-03", "2026-11-06", "travel");
    // The travel block ends at midnight on the 6th, so the 6th itself is clear.
    expect(eventsConflict(travel, timed("collective", "2026-11-06", "09:00", "10:00"))).toBe(false);
    expect(eventsConflict(travel, timed("collective", "2026-11-05", "09:00", "10:00"))).toBe(true);
  });

  it("rule 5 · an overlap with one timed side conflicts", () => {
    // Flagged in SPEC-003 §3: this currently catches any all-day event, not only travel.
    expect(eventsConflict(allDay("family", DAY, "2026-11-05"), timed("collective", DAY, "10:00", "11:00"))).toBe(true);
  });

  it("the PRD's own example · a Collective meeting against a game", () => {
    const meeting = timed("collective", DAY, "18:00", "19:00");
    const game = timed("basketball", DAY, "18:30", "20:30", { kind: "game" });
    expect(eventsConflict(meeting, game)).toBe(true);
    expect(eventsConflict(game, meeting)).toBe(true);
  });

  it("is symmetric and never conflicts with itself", () => {
    const one = timed("collective", DAY, "10:00", "12:00");
    const two = timed("family", DAY, "11:00", "13:00");
    expect(eventsConflict(one, two)).toBe(eventsConflict(two, one));
    expect(eventsConflict(one, { ...one })).toBe(false);
  });

  it("catches an overlap across a midnight boundary", () => {
    const lateFlight = {
      ...timed("basketball", DAY, "22:00", "23:59"),
      endsAt: zonedTimeToInstant("2026-11-05", "02:00", NY),
    };
    expect(eventsConflict(lateFlight, timed("family", "2026-11-05", "01:00", "03:00"))).toBe(true);
  });
});

describe("protectedConflicts", () => {
  const dinner: ProtectedBlock = { label: "Family dinner", days: [3], start: "18:00", end: "19:30" };
  // 2026-11-04 is a Wednesday (weekday 3).
  const days = [{ date: DAY, weekday: weekdayOf(DAY) }];

  it("flags a timed event inside a block on that weekday", () => {
    expect(protectedConflicts(timed("collective", DAY, "18:30", "19:00"), [dinner], days, NY)).toHaveLength(1);
  });

  it("ignores an event that only touches the edges", () => {
    expect(protectedConflicts(timed("collective", DAY, "17:00", "18:00"), [dinner], days, NY)).toHaveLength(0);
    expect(protectedConflicts(timed("collective", DAY, "19:30", "20:30"), [dinner], days, NY)).toHaveLength(0);
  });

  it("ignores a block that does not fall on this weekday", () => {
    const mondayOnly: ProtectedBlock = { ...dinner, days: [1] };
    expect(protectedConflicts(timed("collective", DAY, "18:30", "19:00"), [mondayOnly], days, NY)).toHaveLength(0);
  });

  it("does not trip on an all-day event", () => {
    expect(protectedConflicts(allDay("family", DAY, "2026-11-05"), [dinner], days, NY)).toHaveLength(0);
  });

  it("reports one hit per day for an event spanning two protected evenings", () => {
    const twoDays: ProtectedBlock = { ...dinner, days: [3, 4] };
    const long = {
      ...timed("collective", DAY, "18:30", "19:00"),
      endsAt: zonedTimeToInstant("2026-11-05", "19:00", NY),
    };
    const window = [
      { date: DAY, weekday: 3 },
      { date: "2026-11-05", weekday: 4 },
    ];
    expect(protectedConflicts(long, [twoDays], window, NY)).toHaveLength(2);
  });

  it("returns nothing when there is no protected time at all", () => {
    expect(protectedConflicts(timed("collective", DAY, "18:30", "19:00"), [], days, NY)).toEqual([]);
  });
});

describe("pairKey", () => {
  it("orders a pair the same way whichever side it is given", () => {
    expect(pairKey("bbb", "aaa")).toEqual(["aaa", "bbb"]);
    expect(pairKey("aaa", "bbb")).toEqual(["aaa", "bbb"]);
  });
});

describe("findConflictPairs", () => {
  it("returns each colliding pair once and skips the rest", () => {
    const meeting = timed("collective", DAY, "18:00", "19:00");
    const game = timed("basketball", DAY, "18:30", "20:30", { kind: "game" });
    // 18:45 so it genuinely overlaps the meeting; 19:00 would be back-to-back and clear.
    const practice = timed("basketball", DAY, "18:45", "20:00");
    const morning = timed("collective", DAY, "09:00", "10:00");

    const pairs = findConflictPairs([meeting, game, practice, morning]);
    const titles = pairs.map(({ a, b }) => [a.id, b.id].sort().join("+")).sort();
    // meeting+game and meeting+practice collide; game+practice is basketball-on-basketball.
    expect(titles).toEqual([[meeting.id, game.id].sort().join("+"), [meeting.id, practice.id].sort().join("+")].sort());
  });

  it("is empty for a clear day", () => {
    expect(
      findConflictPairs([timed("collective", DAY, "09:00", "10:00"), timed("family", DAY, "12:00", "13:00")]),
    ).toEqual([]);
  });
});
