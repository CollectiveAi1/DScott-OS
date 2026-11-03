import { describe, expect, it } from "vitest";
import page1 from "./fixtures/google/events-page-1.json";
import page2 from "./fixtures/google/events-page-2.json";
import { mapGoogleEvent, type GoogleEvent } from "../src/modules/google/map-event";

const NY = "America/New_York";
const CALENDAR = "family@group.calendar.google.com";

function mapped(raw: GoogleEvent) {
  const result = mapGoogleEvent(raw, CALENDAR, NY);
  if (result.kind !== "event") throw new Error(`expected an event, got ${result.kind}`);
  return result.event;
}

const byId = (items: GoogleEvent[], id: string) => items.find((item) => item.id === id)!;

describe("mapGoogleEvent · timed events", () => {
  it("maps a timed event to the instants Google gave", () => {
    const event = mapped(byId(page1.items, "timed-dinner"));
    expect(event).toMatchObject({
      externalId: `${CALENDAR}:timed-dinner`,
      title: "Dinner with the Hales",
      allDay: false,
      location: "412 Oak St, Columbus, OH",
      externalUrl: "https://www.google.com/calendar/event?eid=timed-dinner",
    });
    expect(event.startsAt.toISOString()).toBe("2026-11-04T23:00:00.000Z");
    expect(event.endsAt.toISOString()).toBe("2026-11-05T01:00:00.000Z");
  });

  it("never maps description: notes belong to Devon", () => {
    const raw = byId(page1.items, "timed-dinner");
    expect(raw.description).toBeTruthy();
    expect(JSON.stringify(mapped(raw))).not.toContain("Bring the dessert");
  });

  it("falls back to a readable title when Google has no summary", () => {
    expect(mapped(byId(page1.items, "no-summary")).title).toBe("(no title)");
  });
});

describe("mapGoogleEvent · all-day events", () => {
  it("copies Google's exclusive end straight through", () => {
    // Google: 2026-11-05 → 2026-11-06 for a one-day event. This OS stores the same shape.
    const event = mapped(byId(page1.items, "allday-birthday"));
    expect(event.allDay).toBe(true);
    expect(event.startsAt.toISOString()).toBe("2026-11-05T05:00:00.000Z");
    expect(event.endsAt.toISOString()).toBe("2026-11-06T05:00:00.000Z");
  });

  it("maps a multi-day all-day event across its whole span", () => {
    const event = mapped(byId(page1.items, "allday-spring-break"));
    expect(event.startsAt.toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(event.endsAt.toISOString()).toBe("2026-11-14T05:00:00.000Z");
  });

  it("anchors all-day events to local midnight, not UTC midnight", () => {
    const summer = mapped({ id: "x", start: { date: "2026-07-04" }, end: { date: "2026-07-05" } });
    // July is EDT, so local midnight is 04:00Z rather than 05:00Z.
    expect(summer.startsAt.toISOString()).toBe("2026-07-04T04:00:00.000Z");
  });
});

describe("mapGoogleEvent · recurring instances", () => {
  it("treats each expanded instance as its own event", () => {
    const first = mapped(byId(page2.items, "recur_20261110T160000Z"));
    const second = mapped(byId(page2.items, "recur_20261117T160000Z"));
    expect(first.externalId).not.toBe(second.externalId);
    expect(first.title).toBe(second.title);
    expect(first.startsAt.toISOString()).toBe("2026-11-10T16:00:00.000Z");
    expect(second.startsAt.toISOString()).toBe("2026-11-17T16:00:00.000Z");
  });
});

describe("mapGoogleEvent · everything else", () => {
  it("reports a cancelled event as something to remove", () => {
    expect(mapGoogleEvent({ id: "gone", status: "cancelled" }, CALENDAR, NY)).toEqual({
      kind: "cancelled",
      externalId: `${CALENDAR}:gone`,
    });
  });

  it("skips an event with no usable times rather than writing nonsense", () => {
    const result = mapGoogleEvent(byId(page2.items, "malformed-no-times"), CALENDAR, NY);
    expect(result.kind).toBe("skip");
  });

  it("skips an event with no id, unreadable times, or an end before its start", () => {
    expect(mapGoogleEvent({ summary: "no id" }, CALENDAR, NY).kind).toBe("skip");
    expect(
      mapGoogleEvent({ id: "a", start: { dateTime: "not a date" }, end: { dateTime: "nor this" } }, CALENDAR, NY).kind,
    ).toBe("skip");
    expect(
      mapGoogleEvent(
        { id: "b", start: { dateTime: "2026-11-04T12:00:00Z" }, end: { dateTime: "2026-11-04T11:00:00Z" } },
        CALENDAR,
        NY,
      ).kind,
    ).toBe("skip");
    expect(mapGoogleEvent({ id: "c", start: { date: "2026-11-05" } }, CALENDAR, NY).kind).toBe("skip");
  });

  it("namespaces the id by calendar, so two calendars cannot collide", () => {
    const raw = { id: "same", start: { date: "2026-11-05" }, end: { date: "2026-11-06" } };
    expect(mapped(raw).externalId).toBe(`${CALENDAR}:same`);
    expect(mapGoogleEvent(raw, "other@gmail.com", NY)).toMatchObject({
      event: { externalId: "other@gmail.com:same" },
    });
  });
});
