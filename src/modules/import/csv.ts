/**
 * A small RFC 4180 reader. The stack (PRD §6) carries no CSV dependency and the rules are short
 * enough to own: quoted fields may contain the delimiter, a newline, or a doubled quote.
 *
 * It returns cells and the line each row started on, because every error Devon sees has to point
 * at a line in the file he is looking at.
 */
export type CsvRow = { cells: string[]; line: number };

/** Comma or tab, decided by whichever the first line actually contains more of. */
export function detectDelimiter(text: string): "," | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let commas = 0;
  let tabs = 0;
  let quoted = false;
  for (let index = 0; index < firstLine.length; index++) {
    const char = firstLine[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") commas++;
    else if (!quoted && char === "\t") tabs++;
  }
  return tabs > commas ? "\t" : ",";
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): CsvRow[] {
  // A spreadsheet export often starts with a byte-order mark; it is not part of the first header.
  const text = input.replace(/^﻿/, "");

  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let touched = false;
  // A quoted field is content exactly as written; only bare fields get their padding trimmed.
  let wasQuoted = false;

  const endCell = () => {
    cells.push(wasQuoted ? value : value.trim());
    value = "";
    wasQuoted = false;
    touched = true;
  };
  const endRow = () => {
    endCell();
    // A line of nothing but separators is not a row worth reporting on.
    if (cells.some((cell) => cell !== "")) rows.push({ cells, line: rowLine });
    cells = [];
    touched = false;
    rowLine = line;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line++;
        value += char;
      }
      continue;
    }

    if (char === '"' && value.trim() === "") {
      // An opening quote only counts at the start of a field; a stray one mid-value is content.
      value = "";
      quoted = true;
      wasQuoted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\n") {
      line++;
      endRow();
      rowLine = line;
    } else if (char !== "\r") {
      value += char;
      touched = true;
    }
  }

  if (touched || cells.length > 0 || value !== "") endRow();
  return rows;
}
