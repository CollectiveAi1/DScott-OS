import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarEvents } from "@/db/schema";
import { buildPlan, type ExistingEvent, type ImportPlan } from "./plan";
import { parseRows, type ParsedRow, type RowError } from "./parse";

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** Everything an earlier import left behind. Only Basketball is ever imported. */
async function existingImported(db: Db): Promise<ExistingEvent[]> {
  const rows = await db
    .select({
      id: calendarEvents.id,
      externalId: calendarEvents.externalId,
      title: calendarEvents.title,
      kind: calendarEvents.kind,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
      allDay: calendarEvents.allDay,
      location: calendarEvents.location,
    })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.source, "import"), eq(calendarEvents.arena, "basketball")))
    .limit(2000);
  return rows;
}

export type PreviewInput = {
  /** Already-parsed rows (the model path), or raw CSV text. */
  text?: string;
  rows?: ParsedRow[];
  errors?: RowError[];
  timeZone: string;
  now?: Date;
};

function rowsFor(input: PreviewInput): { rows: ParsedRow[]; errors: RowError[] } {
  if (input.rows) return { rows: input.rows, errors: input.errors ?? [] };
  return parseRows(input.text ?? "");
}

/** What this file would do, decided before anything is written. */
export async function previewImport(db: Db, input: PreviewInput): Promise<ImportPlan> {
  const { rows, errors } = rowsFor(input);
  return buildPlan({
    rows,
    errors,
    existing: await existingImported(db),
    timeZone: input.timeZone,
    now: input.now ?? new Date(),
  });
}

export type ImportOutcome = { batch: string; created: number; updated: number; removed: number; unchanged: number };

/**
 * Apply an import. The plan is rebuilt here rather than carried from the preview: the parser is
 * deterministic, so what Devon approved is what runs, and there is no half-built plan sitting in
 * the database going stale.
 */
export async function confirmImport(db: Db, input: PreviewInput): Promise<Result<ImportOutcome>> {
  const plan = await previewImport(db, input);
  if (plan.entries.length === 0 && plan.removals.length === 0) {
    return { ok: false, error: { code: "nothing_to_do", message: "There is nothing in this file to import." } };
  }

  const batch = randomUUID();
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const entry of plan.entries) {
    if (entry.kind === "unchanged") {
      // Genuinely a no-op: re-importing the same file must not even touch updated_at.
      unchanged++;
      continue;
    }

    if (entry.kind === "new") {
      await db.insert(calendarEvents).values({
        title: entry.event.title,
        kind: entry.event.kind as typeof calendarEvents.$inferInsert.kind,
        startsAt: entry.event.startsAt,
        endsAt: entry.event.endsAt,
        allDay: entry.event.allDay,
        location: entry.event.location,
        notes: entry.event.notes,
        source: "import",
        arena: "basketball",
        externalId: entry.event.externalId,
        importBatch: batch,
        createdBy: "automation",
      });
      created++;
      continue;
    }

    // Changed, including a move: the row keeps its id, and with it the notes Devon wrote and
    // any conflict he acknowledged. `notes` is deliberately not overwritten — on an imported
    // event it is his field, the same rule M3 set and M4 follows.
    await db
      .update(calendarEvents)
      .set({
        title: entry.event.title,
        kind: entry.event.kind as typeof calendarEvents.$inferInsert.kind,
        startsAt: entry.event.startsAt,
        endsAt: entry.event.endsAt,
        allDay: entry.event.allDay,
        location: entry.event.location,
        externalId: entry.event.externalId,
        importBatch: batch,
        updatedAt: new Date(),
      })
      .where(eq(calendarEvents.id, entry.existingId));
    updated++;
  }

  if (plan.removals.length > 0) {
    await db.delete(calendarEvents).where(
      inArray(
        calendarEvents.id,
        plan.removals.map((event) => event.id),
      ),
    );
  }

  return { ok: true, data: { batch, created, updated, removed: plan.removals.length, unchanged } };
}
