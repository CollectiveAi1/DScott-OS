import { addDays } from "@/lib/dates";
import type { EventKind } from "@/modules/schedule/kinds";
import { parseCsv, type CsvRow } from "./csv";

/** One row of a schedule, before it becomes an event. Times are wall-clock, not instants. */
export type ParsedRow = {
  line: number;
  date: string;
  /** "HH:MM", or null for an all-day row. */
  start: string | null;
  end: string | null;
  /** Last day, inclusive, for a multi-day all-day row. */
  endDate: string | null;
  kind: EventKind;
  title: string;
  location: string | null;
  notes: string | null;
  allDay: boolean;
  /** Set when the end time was not given and had to be assumed. */
  assumedEnd: string | null;
};

export type RowError = { line: number; message: string };
export type ParseOutcome = { rows: ParsedRow[]; errors: RowError[] };

const GAME_MINUTES = 120;
const DEFAULT_MINUTES = 90;

/** The spellings a real schedule actually uses, mapped to the kinds the OS stores. */
const KINDS: Record<string, EventKind> = {
  practice: "practice",
  training: "practice",
  "s&c": "s_and_c",
  "s and c": "s_and_c",
  "s+c": "s_and_c",
  sandc: "s_and_c",
  s_and_c: "s_and_c",
  strength: "s_and_c",
  "strength and conditioning": "s_and_c",
  lift: "s_and_c",
  "team event": "team_event",
  team_event: "team_event",
  teamevent: "team_event",
  team: "team_event",
  game: "game",
  match: "game",
  travel: "travel",
  trip: "travel",
};

/** Header names are matched loosely: case, spaces, underscores and hyphens all collapse. */
function headerKey(raw: string): string {
  return raw.toLowerCase().replace(/[\s_-]+/g, "");
}

const HEADER_ALIASES: Record<string, string> = {
  date: "date",
  day: "date",
  startdate: "date",
  start: "start",
  starttime: "start",
  time: "start",
  tipoff: "start",
  end: "end",
  endtime: "end",
  finish: "end",
  enddate: "enddate",
  returndate: "enddate",
  through: "enddate",
  type: "type",
  kind: "type",
  category: "type",
  title: "title",
  event: "title",
  opponent: "title",
  description: "title",
  location: "location",
  venue: "location",
  place: "location",
  where: "location",
  notes: "notes",
  note: "notes",
  comment: "notes",
};

export function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);

  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (us) {
    const rawYear = Number(us[3]);
    year = rawYear < 100 ? 2000 + rawYear : rawYear;
    month = Number(us[1]);
    day = Number(us[2]);
  } else {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseTime(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/\./g, "");
  if (!value) return null;

  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(value);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[3];

  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "pm" && hour !== 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour ?? 0) * 60 + (minute ?? 0) + minutes;
  // A row that would run past midnight stops at the end of its day; the importer does not
  // invent a second day for it.
  const capped = Math.min(total, 23 * 60 + 59);
  return `${String(Math.floor(capped / 60)).padStart(2, "0")}:${String(capped % 60).padStart(2, "0")}`;
}

/**
 * Rows of cells into schedule rows. A bad row never stops the file: it comes back as an error
 * carrying the line Devon can find in his spreadsheet, and the rest go on.
 */
export function parseRows(input: string): ParseOutcome {
  const rows = parseCsv(input);
  if (rows.length === 0) return { rows: [], errors: [{ line: 1, message: "There is nothing in this file." }] };

  const [header, ...body] = rows;
  const columns = new Map<string, number>();
  header?.cells.forEach((cell, index) => {
    const alias = HEADER_ALIASES[headerKey(cell)];
    if (alias && !columns.has(alias)) columns.set(alias, index);
  });

  if (!columns.has("date") || !columns.has("title")) {
    return {
      rows: [],
      errors: [
        {
          line: header?.line ?? 1,
          message: "The first line needs at least a date column and a title column. Found: " + (header?.cells.join(", ") || "nothing"),
        },
      ],
    };
  }

  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (const row of body) {
    const fields: RowFields = {};
    for (const [name, index] of columns) fields[name as keyof RowFields] = (row.cells[index] ?? "").trim();

    const outcome = interpretRow(fields, row.line);
    if ("error" in outcome) errors.push(outcome.error);
    else parsed.push(outcome.row);
  }

  return { rows: parsed, errors };
}

/** The fields one schedule row can carry, however they arrived: a CSV column or a model field. */
export type RowFields = Partial<Record<"date" | "start" | "end" | "enddate" | "type" | "title" | "location" | "notes", string>>;

/**
 * One row's worth of rules, in one place. The CSV reader and the model parser both come through
 * here, so a document and a spreadsheet get the same defaults, the same types and the same
 * errors — the model is a parser, not a second code path.
 */
export function interpretRow(fields: RowFields, line: number): { row: ParsedRow } | { error: RowError } {
  {
    const cell = (name: keyof RowFields): string => (fields[name] ?? "").trim();
    const fail = (message: string): { error: RowError } => ({ error: { line, message } });

    const title = cell("title");
    if (!title) return fail("No title.");

    const date = parseDate(cell("date"));
    if (!date) return fail(`Could not read the date "${cell("date")}". Use 2026-11-07 or 11/7/2026.`);

    const rawKind = cell("type").toLowerCase();
    const kind = rawKind ? KINDS[rawKind] : "practice";
    if (!kind) return fail(`Unknown type "${cell("type")}". Use practice, s&c, team event, game or travel.`);

    if (kind === "travel") {
      const endDate = cell("enddate") ? parseDate(cell("enddate")) : date;
      if (!endDate) return fail(`Could not read the return date "${cell("enddate")}".`);
      if (endDate < date) return fail("Travel returns before it departs.");
      return {
        row: {
          line,
          date,
          start: null,
          end: null,
          endDate,
          kind,
          title,
          location: cell("location") || null,
          notes: cell("notes") || null,
          allDay: true,
          assumedEnd: null,
        },
      };
    }

    const start = parseTime(cell("start"));
    if (!start) {
      return fail(
        cell("start")
          ? `Could not read the start time "${cell("start")}". Use 18:00 or 6:00 PM.`
          : "No start time. Only travel can leave it blank.",
      );
    }

    const givenEnd = cell("end") ? parseTime(cell("end")) : null;
    if (cell("end") && !givenEnd) {
      return fail(`Could not read the end time "${cell("end")}". Use 20:00 or 8:00 PM.`);
    }

    // A missing end is an assumption, so the preview says so on the row that made it.
    const assumed = givenEnd ? null : addMinutes(start, kind === "game" ? GAME_MINUTES : DEFAULT_MINUTES);
    const end = givenEnd ?? assumed!;
    if (end <= start) return fail("Ends at or before it starts.");

    return {
      row: {
        line,
        date,
        start,
        end,
        endDate: null,
        kind,
        title,
        location: cell("location") || null,
        notes: cell("notes") || null,
        allDay: false,
        assumedEnd: assumed,
      },
    };
  }
}

/** The last day an all-day row covers, as the exclusive end M3 stores. */
export function exclusiveEndDate(row: ParsedRow): string {
  return addDays(row.endDate ?? row.date, 1);
}
