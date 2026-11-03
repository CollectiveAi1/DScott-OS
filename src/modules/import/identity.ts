import { createHash } from "node:crypto";
import type { ParsedRow } from "./parse";

/**
 * A row's identity, from its content: PRD §8.5's
 * `sha256(normalized date | start | type | title)`.
 *
 * Normalising matters more than the hash does. Two exports of the same schedule differ in
 * casing and spacing far more often than they differ in substance, and an importer that treated
 * "Home vs Dayton" and "Home  vs  dayton" as different events would duplicate a season.
 */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function rowIdentity(row: Pick<ParsedRow, "date" | "start" | "kind" | "title">): string {
  const parts = [row.date, row.start ?? "", row.kind, normalizeTitle(row.title)];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * What makes two rows "the same event at a different time". The start is deliberately left out:
 * this is the key that survives a time change, and it is how a moved practice is recognised as
 * a move rather than as one event added and another removed.
 */
export function moveKey(row: { date: string; kind: string; title: string }): string {
  return [row.date, row.kind, normalizeTitle(row.title)].join("|");
}
