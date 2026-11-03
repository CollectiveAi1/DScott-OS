import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import page1 from "./fixtures/google/events-page-1.json";
import page2 from "./fixtures/google/events-page-2.json";
import afterEdit from "./fixtures/google/events-after-edit.json";
import type { Db } from "../src/db/client";
import { calendarEvents } from "../src/db/schema";
import type { GoogleEvent } from "../src/modules/google/map-event";
import { removeCalendarEvents, syncCalendar, syncWindow, type GoogleApi } from "../src/modules/google/sync";
import { freshDb } from "./helpers/db";

const NY = "America/New_York";
const CALENDAR = "family@group.calendar.google.com";
const NOW = new Date("2026-11-02T15:00:00Z");
const WINDOW = syncWindow(NOW);

type Page = { items: GoogleEvent[]; nextPageToken?: string };

/** A fake Google. Nothing in this file knows Google's hostname. */
function fakeApi(pages: Page[], options: { failOnPage?: number } = {}): GoogleApi & { calls: number } {
  const api = {
    calls: 0,
    async listEvents({ pageToken }: { pageToken?: string }) {
      const index = pageToken ? Number(pageToken) : 0;
      api.calls++;
      if (options.failOnPage === index) throw new Error("Google returned 503");
      const page = pages[index];
      if (!page) throw new Error(`no fixture for page ${index}`);
      return { items: page.items, nextPageToken: index + 1 < pages.length ? String(index + 1) : undefined };
    },
  };
  return api;
}

const paged = (): Page[] => [
  { items: page1.items as GoogleEvent[], nextPageToken: "1" },
  { items: page2.items as GoogleEvent[] },
];

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

const sync = (api: GoogleApi, calendarId = CALENDAR) =>
  syncCalendar(db, api, { calendarId, timeZone: NY, window: WINDOW });

async function rows() {
  return db.select().from(calendarEvents).where(eq(calendarEvents.source, "google"));
}

async function byExternalId(externalId: string) {
  const [row] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.source, "google"), eq(calendarEvents.externalId, externalId)));
  return row;
}

describe("syncCalendar · a first sync", () => {
  it("writes every usable event, following paging to the end", async () => {
    const api = fakeApi(paged());
    const result = await sync(api);

    expect(api.calls).toBe(2);
    // 4 on page one and 3 on page two, of which one is unusable.
    expect(result).toMatchObject({ written: 6, removed: 0, skipped: 1 });
    expect(result.error).toBeUndefined();
    expect(await rows()).toHaveLength(6);
  });

  it("lands page-two events exactly like page-one events", async () => {
    await sync(fakeApi(paged()));
    const lesson = await byExternalId(`${CALENDAR}:recur_20261110T160000Z`);
    expect(lesson).toMatchObject({ title: "Piano lesson", source: "google", arena: "family", kind: "family", allDay: false });
    expect(lesson?.createdBy).toBe("automation");
  });

  it("files everything into the Family arena as a read-only Google row", async () => {
    await sync(fakeApi(paged()));
    for (const row of await rows()) {
      expect(row.arena).toBe("family");
      expect(row.kind).toBe("family");
      expect(row.source).toBe("google");
      expect(row.externalId?.startsWith(`${CALENDAR}:`)).toBe(true);
    }
  });

  it("keeps a recurring event's instances as separate rows", async () => {
    await sync(fakeApi(paged()));
    const lessons = (await rows()).filter((row) => row.title === "Piano lesson");
    expect(lessons).toHaveLength(2);
    expect(new Set(lessons.map((row) => row.externalId)).size).toBe(2);
  });

  it("stores the link back to Google", async () => {
    await sync(fakeApi(paged()));
    expect((await byExternalId(`${CALENDAR}:timed-dinner`))?.externalUrl).toBe(
      "https://www.google.com/calendar/event?eid=timed-dinner",
    );
  });
});

describe("syncCalendar · syncing again", () => {
  it("changes nothing when nothing changed", async () => {
    await sync(fakeApi(paged()));
    const before = await rows();

    const again = await sync(fakeApi(paged()));
    const after = await rows();

    expect(again.removed).toBe(0);
    expect(after).toHaveLength(before.length);
    expect(new Set(after.map((row) => row.id))).toEqual(new Set(before.map((row) => row.id)));
  });

  it("updates an edited event in place, with no duplicate", async () => {
    await sync(fakeApi(paged()));
    const before = await byExternalId(`${CALENDAR}:timed-dinner`);

    await sync(fakeApi([{ items: afterEdit.items as GoogleEvent[] }]));
    const after = await byExternalId(`${CALENDAR}:timed-dinner`);

    expect(after?.id).toBe(before?.id);
    expect(after).toMatchObject({ title: "Dinner with the Hales (moved)", location: "Chapman's, Columbus" });
    expect(after?.startsAt.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect((await rows()).filter((row) => row.externalId === `${CALENDAR}:timed-dinner`)).toHaveLength(1);
  });

  it("removes a cancelled event", async () => {
    await sync(fakeApi(paged()));
    expect(await byExternalId(`${CALENDAR}:allday-birthday`)).toBeTruthy();

    await sync(fakeApi([{ items: afterEdit.items as GoogleEvent[] }]));
    expect(await byExternalId(`${CALENDAR}:allday-birthday`)).toBeUndefined();
  });

  it("removes an event that simply stopped being returned", async () => {
    await sync(fakeApi(paged()));
    expect(await byExternalId(`${CALENDAR}:recur_20261117T160000Z`)).toBeTruthy();

    const result = await sync(fakeApi([{ items: afterEdit.items as GoogleEvent[] }]));
    expect(await byExternalId(`${CALENDAR}:recur_20261117T160000Z`)).toBeUndefined();
    expect(result.removed).toBeGreaterThan(0);
  });

  it("never overwrites the notes Devon wrote on a synced event", async () => {
    await sync(fakeApi(paged()));
    const dinner = await byExternalId(`${CALENDAR}:timed-dinner`);
    await db.update(calendarEvents).set({ notes: "Ask about the car" }).where(eq(calendarEvents.id, dinner!.id));

    // The fixture's description changed too; it must not land anywhere.
    await sync(fakeApi([{ items: afterEdit.items as GoogleEvent[] }]));

    const after = await byExternalId(`${CALENDAR}:timed-dinner`);
    expect(after?.notes).toBe("Ask about the car");
    expect(JSON.stringify(after)).not.toContain("Changed in Google");
  });
});

describe("syncCalendar · failure", () => {
  it("deletes nothing when a later page fails", async () => {
    await sync(fakeApi(paged()));
    const before = await rows();
    expect(before.length).toBeGreaterThan(0);

    // Page one reads fine and would have left every page-two event unseen.
    const result = await sync(fakeApi([{ items: [], nextPageToken: "1" }, { items: [] }], { failOnPage: 1 }));

    expect(result.error).toContain("503");
    expect(result.removed).toBe(0);
    expect(await rows()).toHaveLength(before.length);
  });

  it("deletes nothing when the very first page fails", async () => {
    await sync(fakeApi(paged()));
    const before = await rows();

    const result = await sync(fakeApi([{ items: [] }], { failOnPage: 0 }));
    expect(result.error).toBeTruthy();
    expect(await rows()).toHaveLength(before.length);
  });

  it("returns the failure instead of throwing, so one calendar cannot take down a tick", async () => {
    await expect(sync(fakeApi([{ items: [] }], { failOnPage: 0 }))).resolves.toMatchObject({ error: expect.any(String) });
  });
});

describe("syncCalendar · scoping", () => {
  it("leaves another calendar's events alone", async () => {
    await sync(fakeApi(paged()));
    const otherCalendar = "work@gmail.com";
    await sync(fakeApi([{ items: [page1.items[0] as GoogleEvent] }]), otherCalendar);
    expect(await rows()).toHaveLength(7);

    // An empty sync of the second calendar removes only its own row.
    const result = await sync(fakeApi([{ items: [] }]), otherCalendar);
    expect(result.removed).toBe(1);
    expect(await rows()).toHaveLength(6);
  });

  it("leaves manual events untouched", async () => {
    await db.insert(calendarEvents).values({
      title: "Mine, typed here",
      arena: "family",
      kind: "family",
      startsAt: new Date("2026-11-04T15:00:00Z"),
      endsAt: new Date("2026-11-04T16:00:00Z"),
      source: "manual",
    });

    await sync(fakeApi([{ items: [] }]));
    const manual = await db.select().from(calendarEvents).where(eq(calendarEvents.source, "manual"));
    expect(manual).toHaveLength(1);
  });

  it("does not remove an event that sits outside the synced window", async () => {
    // A year out: outside timeMax, so an empty sync must not touch it.
    await db.insert(calendarEvents).values({
      title: "Far future",
      arena: "family",
      kind: "family",
      startsAt: new Date("2027-11-04T15:00:00Z"),
      endsAt: new Date("2027-11-04T16:00:00Z"),
      source: "google",
      externalId: `${CALENDAR}:far-future`,
    });

    const result = await sync(fakeApi([{ items: [] }]));
    expect(result.removed).toBe(0);
    expect(await byExternalId(`${CALENDAR}:far-future`)).toBeTruthy();
  });
});

describe("removeCalendarEvents", () => {
  it("clears one calendar entirely, for Disconnect", async () => {
    await sync(fakeApi(paged()));
    const removed = await removeCalendarEvents(db, CALENDAR);
    expect(removed).toBe(6);
    expect(await rows()).toHaveLength(0);
  });
});

describe("syncWindow", () => {
  it("is 7 days back and 120 forward", () => {
    const window = syncWindow(NOW);
    expect(window.timeMin.toISOString()).toBe("2026-10-26T15:00:00.000Z");
    expect(window.timeMax.toISOString()).toBe("2027-03-02T15:00:00.000Z");
  });
});
