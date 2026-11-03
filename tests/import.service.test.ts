import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { calendarEvents } from "../src/db/schema";
import { confirmImport, previewImport } from "../src/modules/import/service";
import { freshDb } from "./helpers/db";

const NY = "America/New_York";
// Before every date in the sample, so the whole file counts as future.
const NOW = new Date("2026-11-01T15:00:00Z");

const SAMPLE = readFileSync("docs/samples/basketball-schedule.csv", "utf8");

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.delete(calendarEvents);
});

const preview = (text: string, now = NOW) => previewImport(db, { text, timeZone: NY, now });
const confirm = (text: string, now = NOW) => confirmImport(db, { text, timeZone: NY, now });

async function stored() {
  return db.select().from(calendarEvents).orderBy(calendarEvents.startsAt);
}

describe("the sample file", () => {
  it("previews as all new, and writes nothing until confirmed", async () => {
    const plan = await preview(SAMPLE);
    expect(plan.counts.errors).toBe(0);
    expect(plan.counts.new).toBe(7);
    expect(await stored()).toHaveLength(0);
  });

  it("imports every row as a basketball event from an import", async () => {
    const result = await confirm(SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ created: 7, updated: 0, removed: 0, unchanged: 0 });

    const rows = await stored();
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.source).toBe("import");
      expect(row.arena).toBe("basketball");
      expect(row.createdBy).toBe("automation");
      expect(row.importBatch).toBe(result.data.batch);
      expect(row.externalId).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("reads the kinds, times and travel the sample describes", async () => {
    await confirm(SAMPLE);
    const rows = await stored();

    const game = rows.find((row) => row.title === "Home vs Dayton");
    expect(game).toMatchObject({ kind: "game", allDay: false, location: "Covelli Center" });
    expect(game?.startsAt.toISOString()).toBe("2026-11-07T23:00:00.000Z");

    const lift = rows.find((row) => row.title === "Lift");
    expect(lift?.kind).toBe("s_and_c");
    // No end given: 90 minutes assumed.
    expect(lift && (lift.endsAt.getTime() - lift.startsAt.getTime()) / 60_000).toBe(90);

    const away = rows.find((row) => row.title === "Away vs Toledo");
    // A game with no end gets two hours.
    expect(away && (away.endsAt.getTime() - away.startsAt.getTime()) / 60_000).toBe(120);

    expect(rows.find((row) => row.title === "Road trip to Toledo")).toMatchObject({ kind: "travel", allDay: true });
  });

  it("keeps a quoted comma in a title or note intact", async () => {
    await confirm(SAMPLE);
    const practice = (await stored()).filter((row) => row.title === "Team practice");
    expect(practice.some((row) => row.notes === "Scouting Dayton, bring notes")).toBe(true);
  });
});

describe("importing the same file twice", () => {
  it("changes nothing at all", async () => {
    const first = await confirm(SAMPLE);
    const before = await stored();
    expect(first.ok).toBe(true);

    const plan = await preview(SAMPLE);
    expect(plan.counts).toMatchObject({ new: 0, changed: 0, unchanged: 7, removed: 0 });

    const second = await confirm(SAMPLE);
    expect(second.ok && second.data).toMatchObject({ created: 0, updated: 0, removed: 0, unchanged: 7 });

    const after = await stored();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    // A no-op does not even touch updated_at.
    expect(after.map((row) => row.updatedAt.getTime())).toEqual(before.map((row) => row.updatedAt.getTime()));
  });
});

describe("editing one row and re-importing", () => {
  it("updates exactly one event, in place", async () => {
    await confirm(SAMPLE);
    const before = await stored();
    const practice = before.find((row) => row.title === "Team practice" && row.startsAt < new Date("2026-11-10"))!;

    // The 2026-11-09 practice moves from 09:00 to 10:00.
    const edited = SAMPLE.replace("2026-11-09,09:00,10:30", "2026-11-09,10:00,11:30");

    const plan = await preview(edited);
    expect(plan.counts).toMatchObject({ new: 0, changed: 1, unchanged: 6, removed: 0 });

    const result = await confirm(edited);
    expect(result.ok && result.data).toMatchObject({ created: 0, updated: 1, removed: 0, unchanged: 6 });

    const after = await stored();
    expect(after).toHaveLength(7);
    const moved = after.find((row) => row.id === practice.id)!;
    expect(moved.startsAt.toISOString()).toBe("2026-11-09T15:00:00.000Z");
    // The identity moved with it, so a third import of the edited file is a no-op.
    expect(moved.externalId).not.toBe(practice.externalId);
    expect((await preview(edited)).counts.unchanged).toBe(7);
  });

  it("keeps the notes Devon wrote on an imported event", async () => {
    await confirm(SAMPLE);
    const practice = (await stored()).find((row) => row.title === "Lift")!;
    await db.update(calendarEvents).set({ notes: "Ask about the shoulder" }).where(eq(calendarEvents.id, practice.id));

    const edited = SAMPLE.replace("2026-11-10,07:00,,s&c,Lift,Weight room,End time assumed: 90 minutes", "2026-11-10,08:00,,s&c,Lift,Weight room,Different note in the file");
    await confirm(edited);

    const after = (await stored()).find((row) => row.id === practice.id)!;
    expect(after.notes).toBe("Ask about the shoulder");
    expect(after.startsAt.toISOString()).toBe("2026-11-10T13:00:00.000Z");
  });
});

describe("rows dropped from a later import", () => {
  it("removes a future event, only after confirming", async () => {
    await confirm(SAMPLE);
    const trimmed = SAMPLE.split("\n").filter((line) => !line.includes("Away vs Toledo")).join("\n");

    const plan = await preview(trimmed);
    expect(plan.counts.removed).toBe(1);
    expect(plan.removals[0]?.title).toBe("Away vs Toledo");
    // Still there: a preview writes nothing.
    expect(await stored()).toHaveLength(7);

    await confirm(trimmed);
    expect((await stored()).map((row) => row.title)).not.toContain("Away vs Toledo");
  });

  it("leaves an event that has already happened", async () => {
    await confirm(SAMPLE);
    // Now it is December: every sample date is in the past.
    const december = new Date("2026-12-01T15:00:00Z");
    const trimmed = SAMPLE.split("\n").filter((line) => !line.includes("Away vs Toledo")).join("\n");

    const plan = await preview(trimmed, december);
    expect(plan.counts.removed).toBe(0);

    await confirm(trimmed, december);
    expect(await stored()).toHaveLength(7);
  });

  it("never touches a manual event, or one from Google", async () => {
    await db.insert(calendarEvents).values([
      {
        title: "Typed by hand",
        arena: "basketball",
        kind: "practice",
        startsAt: new Date("2026-11-20T15:00:00Z"),
        endsAt: new Date("2026-11-20T16:00:00Z"),
        source: "manual",
      },
      {
        title: "From Google",
        arena: "family",
        kind: "family",
        startsAt: new Date("2026-11-21T15:00:00Z"),
        endsAt: new Date("2026-11-21T16:00:00Z"),
        source: "google",
        externalId: "cal:1",
      },
    ]);

    await confirm(SAMPLE);
    const titles = (await stored()).map((row) => row.title);
    expect(titles).toContain("Typed by hand");
    expect(titles).toContain("From Google");

    // And an empty-but-valid file does not sweep them away either.
    await confirm("date,start,end,type,title\n2026-11-07,18:00,20:30,game,Home vs Dayton");
    const after = (await stored()).map((row) => row.title);
    expect(after).toContain("Typed by hand");
    expect(after).toContain("From Google");
  });
});

describe("a file with bad rows", () => {
  it("imports the good rows and reports the bad one with its line", async () => {
    const mixed = [
      "date,start,end,type,title",
      "2026-11-07,18:00,20:00,game,Good one",
      "nope,18:00,20:00,game,Bad date",
      "2026-11-09,09:00,10:30,practice,Another good one",
    ].join("\n");

    const plan = await preview(mixed);
    expect(plan.counts).toMatchObject({ new: 2, errors: 1 });
    expect(plan.errors[0]).toMatchObject({ line: 3 });

    const result = await confirm(mixed);
    expect(result.ok && result.data.created).toBe(2);
    expect((await stored()).map((row) => row.title)).toEqual(["Good one", "Another good one"]);
  });

  it("refuses a file with nothing usable in it", async () => {
    expect(await confirm("")).toMatchObject({ ok: false });
    expect(await confirm("when,what\n2026-11-07,Practice")).toMatchObject({ ok: false });
    expect(await stored()).toHaveLength(0);
  });
});
