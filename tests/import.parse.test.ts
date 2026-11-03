import { describe, expect, it } from "vitest";
import { parseDate, parseRows, parseTime } from "../src/modules/import/parse";

const HEADER = "date,start,end,type,title,location,notes";
const file = (...lines: string[]) => [HEADER, ...lines].join("\n");

describe("parseDate", () => {
  it("reads ISO and US forms", () => {
    expect(parseDate("2026-11-07")).toBe("2026-11-07");
    expect(parseDate("11/7/2026")).toBe("2026-11-07");
    expect(parseDate("11/07/26")).toBe("2026-11-07");
    expect(parseDate("2026-1-5")).toBe("2026-01-05");
  });

  it("refuses a date that does not exist, or one it cannot read", () => {
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("13/45/2026")).toBeNull();
    expect(parseDate("Nov 7")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseTime", () => {
  it("reads 24-hour and 12-hour forms", () => {
    expect(parseTime("18:00")).toBe("18:00");
    expect(parseTime("6:00 PM")).toBe("18:00");
    expect(parseTime("6pm")).toBe("18:00");
    expect(parseTime("6 p.m.")).toBe("18:00");
    expect(parseTime("9:30am")).toBe("09:30");
    expect(parseTime("12:00 AM")).toBe("00:00");
    expect(parseTime("12:00 PM")).toBe("12:00");
    expect(parseTime("7")).toBe("07:00");
  });

  it("refuses what it cannot read", () => {
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("6:75")).toBeNull();
    expect(parseTime("13pm")).toBeNull();
    expect(parseTime("evening")).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});

describe("parseRows · the happy path", () => {
  it("reads a full row", () => {
    const { rows, errors } = parseRows(
      file("2026-11-07,18:00,20:30,game,Home vs Dayton,Covelli Center,Senior night"),
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      line: 2,
      date: "2026-11-07",
      start: "18:00",
      end: "20:30",
      kind: "game",
      title: "Home vs Dayton",
      location: "Covelli Center",
      notes: "Senior night",
      allDay: false,
      assumedEnd: null,
    });
  });

  it("accepts every type spelling a real schedule uses", () => {
    const { rows, errors } = parseRows(
      file(
        "2026-11-07,09:00,,practice,Practice",
        "2026-11-08,07:00,,s&c,Lift",
        "2026-11-09,07:00,,strength,Lift",
        "2026-11-10,18:00,,team event,Dinner",
        "2026-11-11,19:00,,Game,Away vs Toledo",
      ),
    );
    expect(errors).toEqual([]);
    expect(rows.map((row) => row.kind)).toEqual(["practice", "s_and_c", "s_and_c", "team_event", "game"]);
  });

  it("matches headers loosely and in any order", () => {
    const { rows, errors } = parseRows(
      ["Title,Start Time,DATE,Venue", "Home vs Dayton,6:00 PM,11/7/2026,Covelli"].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ title: "Home vs Dayton", start: "18:00", date: "2026-11-07", location: "Covelli" });
  });
});

describe("parseRows · assumed end times", () => {
  it("gives a game two hours and everything else ninety minutes", () => {
    const { rows } = parseRows(file("2026-11-07,18:00,,game,Home vs Dayton", "2026-11-08,09:00,,practice,Practice"));
    expect(rows[0]).toMatchObject({ end: "20:00", assumedEnd: "20:00" });
    expect(rows[1]).toMatchObject({ end: "10:30", assumedEnd: "10:30" });
  });

  it("does not flag an end that was given", () => {
    const { rows } = parseRows(file("2026-11-07,18:00,19:00,game,Home vs Dayton"));
    expect(rows[0]?.assumedEnd).toBeNull();
  });

  it("stops an assumed end at the end of its day rather than inventing a second one", () => {
    const { rows } = parseRows(file("2026-11-07,23:00,,game,Late game"));
    expect(rows[0]).toMatchObject({ end: "23:59" });
  });
});

describe("parseRows · travel", () => {
  it("is all-day, from date through end_date", () => {
    const { rows, errors } = parseRows(
      ["date,end_date,type,title", "2026-11-14,2026-11-16,travel,Trip to Toledo"].join("\n"),
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      date: "2026-11-14",
      endDate: "2026-11-16",
      allDay: true,
      start: null,
      end: null,
      kind: "travel",
    });
  });

  it("is a single day when no return date is given", () => {
    const { rows } = parseRows(["date,type,title", "2026-11-14,travel,Day trip"].join("\n"));
    expect(rows[0]).toMatchObject({ date: "2026-11-14", endDate: "2026-11-14", allDay: true });
  });

  it("is the only type allowed to have no start time", () => {
    const { rows, errors } = parseRows(file("2026-11-14,,,travel,Trip", "2026-11-15,,,practice,No time"));
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 3, message: expect.stringContaining("Only travel") });
  });

  it("refuses a return before the departure", () => {
    const { errors } = parseRows(["date,end_date,type,title", "2026-11-16,2026-11-14,travel,Backwards"].join("\n"));
    expect(errors[0]?.message).toContain("returns before");
  });
});

describe("parseRows · errors", () => {
  it("reports a bad row with its line number and keeps the rest", () => {
    const { rows, errors } = parseRows(
      file(
        "2026-11-07,18:00,20:00,game,Good row",
        "not-a-date,18:00,20:00,game,Bad date",
        "2026-11-09,18:00,20:00,game,Another good row",
      ),
    );
    expect(rows.map((row) => row.title)).toEqual(["Good row", "Another good row"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(3);
    expect(errors[0]?.message).toContain("not-a-date");
  });

  it("names every kind of bad cell", () => {
    const { errors } = parseRows(
      file(
        "2026-11-07,18:00,20:00,brunch,Unknown type",
        "2026-11-08,half past six,20:00,game,Bad start",
        "2026-11-09,18:00,quarter past,game,Bad end",
        "2026-11-10,20:00,19:00,game,Backwards",
        "2026-11-11,18:00,20:00,game,",
      ),
    );
    expect(errors.map((error) => error.line)).toEqual([2, 3, 4, 5, 6]);
    expect(errors[0]?.message).toContain("Unknown type");
    expect(errors[1]?.message).toContain("start time");
    expect(errors[2]?.message).toContain("end time");
    expect(errors[3]?.message).toContain("before it starts");
    expect(errors[4]?.message).toContain("No title");
  });

  it("refuses a file with no usable header", () => {
    const { rows, errors } = parseRows("when,what\n2026-11-07,Practice");
    expect(rows).toEqual([]);
    expect(errors[0]?.message).toContain("date column");
  });

  it("refuses an empty file", () => {
    expect(parseRows("").errors[0]?.message).toContain("nothing in this file");
  });

  it("defaults a missing type to practice rather than refusing the row", () => {
    const { rows, errors } = parseRows(["date,start,title", "2026-11-07,09:00,Morning session"].join("\n"));
    expect(errors).toEqual([]);
    expect(rows[0]?.kind).toBe("practice");
  });
});
