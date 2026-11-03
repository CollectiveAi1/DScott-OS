import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { calendarEvents, conflictAcks, tasks, type ProtectedBlock } from "../src/db/schema";
import { conflictsInRange, eventById, eventsInRange } from "../src/modules/schedule/queries";
import {
  acknowledgeConflict,
  createEvent,
  deleteEvent,
  toInstants,
  updateEvent,
  type EventInput,
} from "../src/modules/schedule/service";
import { dayGrid, weekGrid } from "../src/lib/zoned";
import { freshDb } from "./helpers/db";

const NY = "America/New_York";
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.delete(conflictAcks);
  await db.delete(calendarEvents);
  await db.delete(tasks);
});

function input(overrides: Partial<EventInput> = {}): EventInput {
  return {
    title: "Client call",
    arena: "collective",
    kind: "other",
    allDay: false,
    startDate: "2026-11-04",
    startTime: "10:00",
    endDate: "2026-11-04",
    endTime: "11:00",
    location: null,
    notes: null,
    ...overrides,
  };
}

async function create(overrides: Partial<EventInput> = {}) {
  const result = await createEvent(db, input(overrides), NY);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("toInstants", () => {
  it("stores a timed event at the wall time Devon typed", () => {
    const { startsAt, endsAt } = toInstants(input(), NY);
    expect(startsAt.toISOString()).toBe("2026-11-04T15:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-11-04T16:00:00.000Z");
  });

  it("stores an all-day event midnight to exclusive midnight", () => {
    const single = toInstants(input({ allDay: true, startDate: "2026-11-05", endDate: "2026-11-05" }), NY);
    expect(single.startsAt.toISOString()).toBe("2026-11-05T05:00:00.000Z");
    expect(single.endsAt.toISOString()).toBe("2026-11-06T05:00:00.000Z");

    const span = toInstants(input({ allDay: true, startDate: "2026-11-05", endDate: "2026-11-07" }), NY);
    expect(span.endsAt.toISOString()).toBe("2026-11-08T05:00:00.000Z");
  });
});

describe("createEvent", () => {
  it("saves a manual event", async () => {
    const event = await create();
    expect(event).toMatchObject({ title: "Client call", source: "manual", allDay: false, createdBy: "devon" });
  });

  it("refuses an end at or before the start", async () => {
    expect(await createEvent(db, input({ endTime: "10:00" }), NY)).toMatchObject({
      ok: false,
      error: { code: "bad_range" },
    });
    expect(await createEvent(db, input({ endTime: "09:00" }), NY)).toMatchObject({ ok: false });
    expect(await db.select().from(calendarEvents)).toHaveLength(0);
  });

  it("refuses a kind that does not belong to the arena", async () => {
    expect(await createEvent(db, input({ arena: "collective", kind: "practice" }), NY)).toMatchObject({
      ok: false,
      error: { code: "bad_kind" },
    });
  });

  it("accepts basketball travel as a multi-day all-day event", async () => {
    const travel = await create({
      title: "Away trip",
      arena: "basketball",
      kind: "travel",
      allDay: true,
      startDate: "2026-11-06",
      endDate: "2026-11-08",
    });
    expect(travel.allDay).toBe(true);
    expect(travel.endsAt.toISOString()).toBe("2026-11-09T05:00:00.000Z");
  });

  it("completes the capture it was made from", async () => {
    const [task] = await db.insert(tasks).values({ title: "Book the flight", fromMisc: true }).returning();
    await createEvent(db, input({ title: "Flight to Dayton" }), NY, { fromTaskId: task!.id });

    const [after] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(after).toMatchObject({ status: "done", fromMisc: false });
    expect(after?.completedAt).toBeInstanceOf(Date);
  });

  it("still saves the event when the capture is already gone", async () => {
    const result = await createEvent(db, input(), NY, { fromTaskId: "00000000-0000-0000-0000-000000000000" });
    expect(result.ok).toBe(true);
  });
});

describe("updateEvent", () => {
  it("writes every field on a manual event", async () => {
    const event = await create();
    const result = await updateEvent(
      db,
      event.id,
      input({ title: "Client call (moved)", startTime: "14:00", endTime: "15:00", location: "Zoom", notes: "Agenda" }),
      NY,
    );
    expect(result.ok).toBe(true);
    expect(await eventById(db, event.id)).toMatchObject({ title: "Client call (moved)", location: "Zoom", notes: "Agenda" });
    expect((await eventById(db, event.id))?.startsAt.toISOString()).toBe("2026-11-04T19:00:00.000Z");
  });

  it("writes only notes on a Google or imported event, whatever else is posted", async () => {
    for (const source of ["google", "import"] as const) {
      const [row] = await db
        .insert(calendarEvents)
        .values({
          title: "Owned elsewhere",
          arena: "family",
          kind: "family",
          startsAt: new Date("2026-11-04T15:00:00Z"),
          endsAt: new Date("2026-11-04T16:00:00Z"),
          source,
          externalId: `${source}-1`,
        })
        .returning();

      const result = await updateEvent(
        db,
        row!.id,
        input({ title: "Renamed", arena: "collective", startTime: "20:00", endTime: "21:00", notes: "Mine" }),
        NY,
      );
      expect(result.ok).toBe(true);
      expect(await eventById(db, row!.id)).toMatchObject({
        title: "Owned elsewhere",
        arena: "family",
        notes: "Mine",
      });
      expect((await eventById(db, row!.id))?.startsAt.toISOString()).toBe("2026-11-04T15:00:00.000Z");
    }
  });

  it("reports an event that is gone", async () => {
    expect(await updateEvent(db, "00000000-0000-0000-0000-000000000000", input(), NY)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});

describe("acknowledgeConflict", () => {
  async function conflictingPair() {
    const meeting = await create({ title: "Client call", startTime: "18:00", endTime: "19:00" });
    const game = await create({
      title: "Home game",
      arena: "basketball",
      kind: "game",
      startTime: "18:30",
      endTime: "20:30",
    });
    return { meeting, game };
  }

  const window = () => dayGrid("2026-11-04", NY);

  it("hides a pair once acknowledged, and is idempotent", async () => {
    const { meeting, game } = await conflictingPair();
    const grid = window();

    let conflicts = await conflictsInRange(db, grid.from, grid.to, [], NY, grid.days);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "pair", acknowledged: false });

    expect((await acknowledgeConflict(db, meeting.id, game.id)).ok).toBe(true);
    // Again, and with the pair the other way round: still one row.
    expect((await acknowledgeConflict(db, game.id, meeting.id)).ok).toBe(true);
    expect(await db.select().from(conflictAcks)).toHaveLength(1);

    conflicts = await conflictsInRange(db, grid.from, grid.to, [], NY, grid.days);
    expect(conflicts[0]).toMatchObject({ acknowledged: true });
  });

  it("brings the conflict back when either event's time changes", async () => {
    const { meeting, game } = await conflictingPair();
    await acknowledgeConflict(db, meeting.id, game.id);

    // Moving it still overlapping: the ack is cleared and the conflict returns.
    await updateEvent(db, meeting.id, input({ title: "Client call", startTime: "18:15", endTime: "19:15" }), NY);
    expect(await db.select().from(conflictAcks)).toHaveLength(0);

    const grid = window();
    const conflicts = await conflictsInRange(db, grid.from, grid.to, [], NY, grid.days);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ acknowledged: false });
    expect(game.id).toBeTruthy();
  });

  it("keeps the ack when only the title or notes change", async () => {
    const { meeting, game } = await conflictingPair();
    await acknowledgeConflict(db, meeting.id, game.id);

    await updateEvent(db, meeting.id, input({ title: "Client call — renamed", startTime: "18:00", endTime: "19:00", notes: "n" }), NY);
    expect(await db.select().from(conflictAcks)).toHaveLength(1);
  });

  it("goes away with the event it belongs to", async () => {
    const { meeting, game } = await conflictingPair();
    await acknowledgeConflict(db, meeting.id, game.id);
    expect((await deleteEvent(db, meeting.id)).ok).toBe(true);
    expect(await db.select().from(conflictAcks)).toHaveLength(0);
  });

  it("refuses a pair that is really one event", async () => {
    const { meeting } = await conflictingPair();
    expect(await acknowledgeConflict(db, meeting.id, meeting.id)).toMatchObject({ ok: false, error: { code: "bad_pair" } });
  });
});

describe("conflictsInRange · protected time", () => {
  const dinner: ProtectedBlock = { label: "Family dinner", days: [3], start: "18:00", end: "19:30" };

  it("flags a timed event inside protected time and cannot acknowledge it", async () => {
    await create({ title: "Evening call", startTime: "18:30", endTime: "19:00" });
    const grid = dayGrid("2026-11-04", NY);

    const conflicts = await conflictsInRange(db, grid.from, grid.to, [dinner], NY, grid.days);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "protected" });
    if (conflicts[0]?.kind === "protected") expect(conflicts[0].hit.block.label).toBe("Family dinner");
  });

  it("leaves an all-day event alone", async () => {
    await create({ title: "Maya's birthday", arena: "family", kind: "family", allDay: true, startDate: "2026-11-04", endDate: "2026-11-04" });
    const grid = dayGrid("2026-11-04", NY);
    const conflicts = await conflictsInRange(db, grid.from, grid.to, [dinner], NY, grid.days);
    expect(conflicts.filter((conflict) => conflict.kind === "protected")).toHaveLength(0);
  });
});

describe("eventsInRange", () => {
  it("includes an event that started before the window and runs into it", async () => {
    await create({
      title: "Away trip",
      arena: "basketball",
      kind: "travel",
      allDay: true,
      startDate: "2026-11-02",
      endDate: "2026-11-05",
    });
    const wednesday = dayGrid("2026-11-04", NY);
    expect((await eventsInRange(db, wednesday.from, wednesday.to)).map((event) => event.title)).toEqual(["Away trip"]);
  });

  it("excludes an all-day event the day after it ends", async () => {
    await create({ title: "One day only", allDay: true, startDate: "2026-11-04", endDate: "2026-11-04" });
    const next = dayGrid("2026-11-05", NY);
    expect(await eventsInRange(db, next.from, next.to)).toHaveLength(0);
    const same = dayGrid("2026-11-04", NY);
    expect(await eventsInRange(db, same.from, same.to)).toHaveLength(1);
  });

  it("covers a whole week in one read", async () => {
    await create({ title: "Monday", startDate: "2026-11-02", endDate: "2026-11-02" });
    await create({ title: "Sunday", startDate: "2026-11-08", endDate: "2026-11-08" });
    await create({ title: "Next Monday", startDate: "2026-11-09", endDate: "2026-11-09" });

    const week = weekGrid("2026-11-04", NY);
    expect((await eventsInRange(db, week.from, week.to)).map((event) => event.title)).toEqual(["Monday", "Sunday"]);
  });
});
