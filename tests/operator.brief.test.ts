import { describe, expect, it } from "vitest";
import { startOfDayInstant, zonedTimeToInstant } from "../src/lib/zoned";
import {
  briefIsEmpty,
  buildBrief,
  itemFor,
  type BriefEvent,
  type BriefInput,
} from "../src/modules/operator/brief";
import { renderBrief } from "../src/modules/operator/render-brief";

const NY = "America/New_York";
const DAY = "2026-11-10";
let nextId = 0;

function timed(arena: string, start: string, end: string, extra: Partial<BriefEvent> = {}): BriefEvent {
  return {
    id: `e${++nextId}`,
    title: `${arena} at ${start}`,
    arena,
    kind: "other",
    allDay: false,
    startsAt: zonedTimeToInstant(DAY, start, NY),
    endsAt: zonedTimeToInstant(DAY, end, NY),
    ...extra,
  };
}

function allDay(arena: string, from: string, toExclusive: string, extra: Partial<BriefEvent> = {}): BriefEvent {
  return {
    id: `a${++nextId}`,
    title: `${arena} all day`,
    arena,
    kind: "other",
    allDay: true,
    startsAt: startOfDayInstant(from, NY),
    endsAt: startOfDayInstant(toExclusive, NY),
    ...extra,
  };
}

const empty: BriefInput = {
  day: DAY,
  timeZone: NY,
  events: [],
  conflicts: [],
  tasks: [],
  deals: [],
  approvalsWaiting: 0,
  miscInbox: 0,
  tomorrowFamily: [],
};

describe("buildBrief", () => {
  it("groups today's events by arena in a fixed order", () => {
    const data = buildBrief({
      ...empty,
      events: [timed("misc", "15:00", "15:30"), timed("basketball", "18:00", "20:00"), timed("collective", "09:00", "10:00")],
    });
    expect(data.byArena.map((group) => group.arena)).toEqual(["collective", "basketball", "misc"]);
  });

  it("orders events within an arena by start time, all-day first", () => {
    const data = buildBrief({
      ...empty,
      events: [timed("collective", "14:00", "15:00"), allDay("collective", DAY, "2026-11-11"), timed("collective", "09:00", "10:00")],
    });
    expect(data.byArena[0]?.items.map((item) => item.when)).toEqual(["All day", "09:00–10:00", "14:00–15:00"]);
  });

  it("lists travel separately, whatever arena it is in", () => {
    const data = buildBrief({
      ...empty,
      events: [allDay("basketball", DAY, "2026-11-13", { kind: "travel", title: "Away at Dayton" })],
    });
    expect(data.travel.map((item) => item.title)).toEqual(["Away at Dayton"]);
  });

  it("splits tasks into overdue and due today", () => {
    const data = buildBrief({
      ...empty,
      tasks: [
        { id: "1", title: "Late one", due: "2026-11-08", arena: "collective", priority: "high" },
        { id: "2", title: "Today one", due: DAY, arena: "misc", priority: "normal" },
      ],
    });
    expect(data.overdue.map((task) => task.title)).toEqual(["Late one"]);
    expect(data.dueToday.map((task) => task.title)).toEqual(["Today one"]);
  });

  it("separates deals with no next step from deals with an overdue one", () => {
    const data = buildBrief({
      ...empty,
      deals: [
        { id: "1", title: "Pilot", pipeline: "Kinetic Scholar", stage: "Quote sent", nextStep: null, nextStepDue: null },
        { id: "2", title: "Build", pipeline: "Client builds", stage: "Deposit", nextStep: "Chase", nextStepDue: "2026-11-01" },
        { id: "3", title: "Fine", pipeline: "Client builds", stage: "Deposit", nextStep: "Chase", nextStepDue: "2026-12-01" },
      ],
    });
    expect(data.deals.noNextStep.map((deal) => deal.title)).toEqual(["Pilot"]);
    expect(data.deals.overdue.map((deal) => deal.title)).toEqual(["Build"]);
  });

  it("treats a blank next step as no next step", () => {
    const data = buildBrief({
      ...empty,
      deals: [{ id: "1", title: "Pilot", pipeline: "P", stage: "S", nextStep: "   ", nextStepDue: "2026-11-01" }],
    });
    expect(data.deals.noNextStep).toHaveLength(1);
    expect(data.deals.overdue).toHaveLength(0);
  });

  it("carries family events for today and tomorrow", () => {
    const data = buildBrief({
      ...empty,
      events: [timed("family", "17:00", "18:00")],
      tomorrowFamily: [
        {
          id: "f1",
          title: "Dentist",
          arena: "family",
          kind: "family",
          allDay: false,
          startsAt: zonedTimeToInstant("2026-11-11", "09:00", NY),
          endsAt: zonedTimeToInstant("2026-11-11", "09:45", NY),
        },
      ],
    });
    expect(data.family.today).toHaveLength(1);
    expect(data.family.tomorrow[0]).toMatchObject({ title: "Dentist", when: "09:00–09:45" });
  });

  it("knows when a day is genuinely empty", () => {
    expect(briefIsEmpty(buildBrief(empty))).toBe(true);
    expect(briefIsEmpty(buildBrief({ ...empty, miscInbox: 1 }))).toBe(false);
  });
});

describe("itemFor", () => {
  it("labels a multi-day all-day event by where today sits in it", () => {
    const trip = allDay("basketball", DAY, "2026-11-13", { kind: "travel" });
    expect(itemFor(trip, DAY, NY).when).toBe("All day, through 2026-11-12");
    expect(itemFor(trip, "2026-11-11", NY).when).toBe("All day, 2026-11-10 to 2026-11-12");
    expect(itemFor(trip, "2026-11-12", NY).when).toBe("All day, back today");
  });

  it("dates a timed event that runs past midnight", () => {
    const late: BriefEvent = {
      id: "x",
      title: "Red eye",
      arena: "family",
      kind: "family",
      allDay: false,
      startsAt: zonedTimeToInstant(DAY, "22:00", NY),
      endsAt: zonedTimeToInstant("2026-11-11", "02:00", NY),
    };
    expect(itemFor(late, DAY, NY).when).toBe("22:00–2026-11-11 02:00");
  });
});

describe("renderBrief", () => {
  it("says so plainly when there is nothing at all", () => {
    expect(renderBrief(buildBrief(empty))).toBe(`Brief · ${DAY}\n\nNothing scheduled, nothing due, nothing waiting. A clear day.`);
  });

  it("is deterministic for fixed data", () => {
    const input: BriefInput = {
      ...empty,
      events: [timed("collective", "09:00", "10:00", { title: "Kinetic Edge standup" })],
      conflicts: [{ left: "Kinetic Edge standup", right: "Game vs Dayton", when: "2026-11-11 18:00" }],
      tasks: [{ id: "1", title: "Send pilot quote", due: "2026-11-08", arena: "collective", priority: "high" }],
      deals: [{ id: "1", title: "Pilot", pipeline: "Kinetic Scholar", stage: "Quote sent", nextStep: null, nextStepDue: null }],
      approvalsWaiting: 2,
      miscInbox: 1,
    };
    const once = renderBrief(buildBrief(input));
    expect(renderBrief(buildBrief(input))).toBe(once);
    expect(once).toMatchInlineSnapshot(`
      "Brief · 2026-11-10

      Collective
      - 09:00–10:00 · Kinetic Edge standup

      Conflicts in the next 72 hours (1)
      - 2026-11-11 18:00 · Kinetic Edge standup clashes with Game vs Dayton

      Overdue (1)
      - Send pilot quote (due 2026-11-08) · high

      Deals needing a next step (1)
      - Pilot · Kinetic Scholar · Quote sent — no next step

      2 approvals waiting, 1 capture untriaged in Misc."
    `);
  });

  it("says when the calendar is clear but other things are not", () => {
    const text = renderBrief(buildBrief({ ...empty, approvalsWaiting: 1 }));
    expect(text).toContain("Nothing on the calendar today.");
    expect(text).toContain("1 approval waiting.");
  });
});
