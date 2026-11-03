import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "../src/modules/import/csv";

const cellsOf = (text: string) => parseCsv(text).map((row) => row.cells);

describe("detectDelimiter", () => {
  it("picks comma or tab by what the header line uses", () => {
    expect(detectDelimiter("date,start,type\n2026-11-07,18:00,game")).toBe(",");
    expect(detectDelimiter("date\tstart\ttype\n2026-11-07\t18:00\tgame")).toBe("\t");
  });

  it("is not fooled by commas inside a quoted header", () => {
    expect(detectDelimiter('"last, first"\tnote\nx\ty')).toBe("\t");
  });

  it("falls back to comma for a single-column file", () => {
    expect(detectDelimiter("title\nPractice")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("reads a plain file", () => {
    expect(cellsOf("date,start,title\n2026-11-07,18:00,Home game")).toEqual([
      ["date", "start", "title"],
      ["2026-11-07", "18:00", "Home game"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    expect(cellsOf('date,title\n2026-11-07,"Game vs Dayton, away"')).toEqual([
      ["date", "title"],
      ["2026-11-07", "Game vs Dayton, away"],
    ]);
  });

  it("keeps a newline inside a quoted field, and counts the line past it", () => {
    const rows = parseCsv('date,notes\n2026-11-07,"two\nlines"\n2026-11-08,after');
    expect(rows[1]?.cells).toEqual(["2026-11-07", "two\nlines"]);
    // The row after a two-line field still reports the line it really starts on.
    expect(rows[2]).toEqual({ cells: ["2026-11-08", "after"], line: 4 });
  });

  it("unescapes a doubled quote", () => {
    expect(cellsOf('title\n"The ""big"" one"')).toEqual([["title"], ['The "big" one']]);
  });

  it("handles tabs as the delimiter", () => {
    expect(cellsOf("date\tstart\ttitle\n2026-11-07\t18:00\tHome game")).toEqual([
      ["date", "start", "title"],
      ["2026-11-07", "18:00", "Home game"],
    ]);
  });

  it("reports the line each row started on", () => {
    const rows = parseCsv("a,b\n1,2\n3,4");
    expect(rows.map((row) => row.line)).toEqual([1, 2, 3]);
  });

  it("survives CRLF, a trailing newline and a byte-order mark", () => {
    expect(cellsOf("﻿date,title\r\n2026-11-07,Game\r\n")).toEqual([
      ["date", "title"],
      ["2026-11-07", "Game"],
    ]);
  });

  it("skips blank lines without counting them as rows", () => {
    const rows = parseCsv("a,b\n\n1,2\n   \n3,4");
    expect(rows.map((row) => row.cells)).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps a ragged row rather than padding or dropping it", () => {
    // The parser reports what is there; deciding a row is short is the next layer's job.
    expect(cellsOf("a,b,c\n1,2")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ]);
  });

  it("trims surrounding whitespace but not what is inside quotes", () => {
    expect(cellsOf('a,b\n  x  ,"  y  "')).toEqual([
      ["a", "b"],
      ["x", "  y  "],
    ]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});
