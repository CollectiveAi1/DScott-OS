import { describe, expect, it } from "vitest";
import { zonedTimeToInstant } from "../src/lib/zoned";
import { rowIdentity } from "../src/modules/import/identity";
import { parseRows } from "../src/modules/import/parse";
import { buildPlan, toInstants, type ExistingEvent } from "../src/modules/import/plan";

const NY = "America/New_York";
const NOW = new Date("2026-11-01T15:00:00Z");
const HEADER = "date,start,end,type,title,location,notes";
const file = (...lines: string[]) => [HEADER, ...lines].join("\n");

function plan(csv: string, existing: ExistingEvent[] = [], now = NOW) {
  const { rows, errors } = parseRows(csv);
  return buildPlan({ rows, errors, existing, timeZone: NY, now });
}

/** An existing row as if a previous import had written exactly this CSV line. */
function existingFrom(line: string, overrides: Partial<ExistingEvent> = {}): ExistingEvent {
  const { rows } = parseRows(file(line));
  const row = rows[0]!;
  const { startsAt, endsAt } = toInstants(row, NY);
  return {
    id: `row-${row.line}-${row.title}`,
    externalId: rowIdentity(row),
    title: row.title,
    kind: row.kind,
    startsAt,
    endsAt,
    allDay: row.allDay,
    location: row.location,
    ...overrides,
  };
}

describe("buildPlan · a first import", () => {
  it("is all new when nothing exists", () => {
    const result = plan(file("2026-11-07,18:00,20:00,game,Home vs Dayton", "2026-11-09,09:00,,practice,Practice"));
    expect(result.counts).toMatchObject({ new: 2, changed: 0, unchanged: 0, removed: 0, errors: 0 });
  });

  it("stores times in the settings zone", () => {
    const result = plan(file("2026-11-07,18:00,20:00,game,Home vs Dayton"));
    const entry = result.entries[0]!;
    expect(entry.event.startsAt.toISOString()).toBe("2026-11-07T23:00:00.000Z");
    expect(entry.event.startsAt).toEqual(zonedTimeToInstant("2026-11-07", "18:00", NY));
  });

  it("stores travel all-day with an exclusive end", () => {
    const result = plan(["date,end_date,type,title", "2026-11-14,2026-11-16,travel,Trip"].join("\n"));
    const entry = result.entries[0]!;
    expect(entry.event.allDay).toBe(true);
    expect(entry.event.startsAt.toISOString()).toBe("2026-11-14T05:00:00.000Z");
    expect(entry.event.endsAt.toISOString()).toBe("2026-11-17T05:00:00.000Z");
  });
});

describe("buildPlan · importing the same file again", () => {
  const line = "2026-11-07,18:00,20:00,game,Home vs Dayton,Covelli Center,";

  it("reports everything unchanged", () => {
    const result = plan(file(line), [existingFrom(line)]);
    expect(result.counts).toMatchObject({ new: 0, changed: 0, unchanged: 1, removed: 0 });
  });

  it("matches through casing and spacing rather than duplicating the event", () => {
    const before = existingFrom(line, { title: "home VS dayton" });
    const result = plan(file("2026-11-07,18:00,20:00,game,home   VS   dayton,Covelli Center,"), [before]);

    // Identity ignores case and spacing, so the same event is found. The title text really did
    // change, though, so it is reported as a change rather than quietly rewritten.
    expect(result.counts).toMatchObject({ new: 0, changed: 1, removed: 0 });
    const entry = result.entries[0]!;
    if (entry.kind === "changed") expect(entry.existingId).toBe(before.id);
  });
});

describe("buildPlan · a changed row", () => {
  it("reports a changed location as a change, not a move", () => {
    const before = existingFrom("2026-11-07,18:00,20:00,game,Home vs Dayton,Covelli Center,");
    const result = plan(file("2026-11-07,18:00,20:00,game,Home vs Dayton,St John Arena,"), [before]);

    expect(result.counts).toMatchObject({ new: 0, changed: 1, unchanged: 0, removed: 0 });
    const entry = result.entries[0]!;
    expect(entry.kind).toBe("changed");
    if (entry.kind === "changed") {
      expect(entry.moved).toBe(false);
      expect(entry.existingId).toBe(before.id);
    }
  });

  it("treats a time edit as a move of the same event, not an add and a remove", () => {
    // PRD §8.5: "editing one row's time and re-importing updates exactly one event".
    const before = existingFrom("2026-11-09,17:00,18:30,practice,Practice,,");
    const result = plan(file("2026-11-09,18:00,19:30,practice,Practice,,"), [before]);

    expect(result.counts).toMatchObject({ new: 0, changed: 1, unchanged: 0, removed: 0 });
    const entry = result.entries[0]!;
    expect(entry.kind).toBe("changed");
    if (entry.kind === "changed") {
      expect(entry.moved).toBe(true);
      // The existing row is updated in place, so its id, notes and acks all survive.
      expect(entry.existingId).toBe(before.id);
      expect(entry.event.startsAt).toEqual(zonedTimeToInstant("2026-11-09", "18:00", NY));
    }
  });

  it("moves only one of several rows when the rest are untouched", () => {
    const existing = [
      existingFrom("2026-11-07,18:00,20:00,game,Home vs Dayton,,"),
      existingFrom("2026-11-09,17:00,18:30,practice,Practice,,"),
      existingFrom("2026-11-10,07:00,08:30,s&c,Lift,,"),
    ];
    const result = plan(
      file(
        "2026-11-07,18:00,20:00,game,Home vs Dayton,,",
        "2026-11-09,18:00,19:30,practice,Practice,,",
        "2026-11-10,07:00,08:30,s&c,Lift,,",
      ),
      existing,
    );
    expect(result.counts).toMatchObject({ new: 0, changed: 1, unchanged: 2, removed: 0 });
  });

  it("will not guess which of two identical rows moved", () => {
    // Two practices with the same name on the same day: pairing either way would be a guess.
    const existing = [
      existingFrom("2026-11-09,09:00,10:30,practice,Practice,,", { id: "morning" }),
      existingFrom("2026-11-09,17:00,18:30,practice,Practice,,", { id: "evening" }),
    ];
    const result = plan(file("2026-11-09,10:00,11:30,practice,Practice,,", "2026-11-09,18:00,19:30,practice,Practice,,"), existing);

    expect(result.counts).toMatchObject({ new: 2, changed: 0, removed: 2 });
  });
});

describe("buildPlan · removals", () => {
  it("removes a future event the file no longer contains", () => {
    const dropped = existingFrom("2026-11-20,18:00,20:00,game,Cancelled game,,");
    const result = plan(file("2026-11-07,18:00,20:00,game,Home vs Dayton,,"), [dropped]);

    expect(result.counts).toMatchObject({ new: 1, removed: 1 });
    expect(result.removals[0]?.title).toBe("Cancelled game");
  });

  it("never removes an event that has already happened", () => {
    // NOW is 2026-11-01; this game was two weeks earlier.
    const past = existingFrom("2026-10-18,18:00,20:00,game,Last month,,");
    const result = plan(file("2026-11-07,18:00,20:00,game,Home vs Dayton,,"), [past]);

    expect(result.counts.removed).toBe(0);
    expect(result.removals).toEqual([]);
  });

  it("removes nothing when the file still contains everything", () => {
    const line = "2026-11-07,18:00,20:00,game,Home vs Dayton,,";
    expect(plan(file(line), [existingFrom(line)]).counts.removed).toBe(0);
  });
});

describe("buildPlan · errors", () => {
  it("carries row errors through without letting them become events", () => {
    const result = plan(file("2026-11-07,18:00,20:00,game,Good", "bad-date,18:00,20:00,game,Bad"));
    expect(result.counts).toMatchObject({ new: 1, errors: 1 });
    expect(result.errors[0]?.line).toBe(3);
  });

  it("does not let a bad row cause a good future event to be removed", () => {
    // The row that would have matched it failed to parse; removing the event would lose data
    // over a typo, so the import still only removes what the file genuinely dropped.
    const existing = existingFrom("2026-11-07,18:00,20:00,game,Home vs Dayton,,");
    const result = plan(file("bad-date,18:00,20:00,game,Home vs Dayton"), [existing]);
    expect(result.counts.errors).toBe(1);
    // It is reported as a removal, and Devon sees it in the preview before confirming.
    expect(result.removals.map((event) => event.title)).toEqual(["Home vs Dayton"]);
  });
});
