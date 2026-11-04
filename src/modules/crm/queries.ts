import { and, arrayOverlaps, asc, desc, eq, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { approvals, contacts, deals, orgs, pipelines, tasks, timeline } from "@/db/schema";
import type { Contact, Deal, Pipeline } from "./service";

export type ContactRow = Contact & { orgName: string | null };

/**
 * One search box over everything Devon might remember someone by: either name, email, phone,
 * a tag, or the organisation. He will not recall which field he knows them through.
 */
export async function searchContacts(
  db: Db,
  input: { query: string; types: string[]; limit?: number },
): Promise<ContactRow[]> {
  const conditions: SQL[] = [];

  const query = input.query.trim();
  if (query) {
    const like = `%${query.toLowerCase()}%`;
    const match = or(
      sql`lower(${contacts.firstName}) like ${like}`,
      sql`lower(coalesce(${contacts.lastName}, '')) like ${like}`,
      sql`lower(coalesce(${contacts.email}, '')) like ${like}`,
      // Punctuation in a stored phone number should not stop a digits-only search matching.
      sql`regexp_replace(coalesce(${contacts.phone}, ''), '[^0-9]', '', 'g') like ${`%${query.replace(/\D/g, "")}%`} and ${query.replace(/\D/g, "") !== ""}`,
      sql`lower(coalesce(${orgs.name}, '')) like ${like}`,
      sql`exists (select 1 from unnest(${contacts.tags}) tag where lower(tag) like ${like})`,
    );
    if (match) conditions.push(match);
  }

  if (input.types.length > 0) conditions.push(arrayOverlaps(contacts.types, input.types));

  const rows = await db
    .select({ contact: contacts, orgName: orgs.name })
    .from(contacts)
    .leftJoin(orgs, eq(contacts.orgId, orgs.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(contacts.firstName), asc(contacts.lastName))
    .limit(input.limit ?? 200);

  return rows.map((row) => ({ ...row.contact, orgName: row.orgName }));
}

export async function contactById(db: Db, id: string): Promise<ContactRow | null> {
  const [row] = await db
    .select({ contact: contacts, orgName: orgs.name })
    .from(contacts)
    .leftJoin(orgs, eq(contacts.orgId, orgs.id))
    .where(eq(contacts.id, id))
    .limit(1);
  return row ? { ...row.contact, orgName: row.orgName } : null;
}

export async function dealsForContact(db: Db, contactId: string): Promise<Deal[]> {
  return db.select().from(deals).where(eq(deals.contactId, contactId)).orderBy(desc(deals.updatedAt));
}

export async function openTasksForContact(db: Db, contactId: string) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.contactId, contactId), eq(tasks.status, "open")))
    .orderBy(sql`${tasks.due} asc nulls last`)
    .limit(50);
}

// ---------------------------------------------------------------------------
// The merged timeline
// ---------------------------------------------------------------------------

export type TimelineItem = {
  id: string;
  at: Date;
  kind: "note" | "call" | "email" | "meeting" | "stage_move" | "task_done" | "approval";
  body: string;
  detail?: string;
};

export type TimelineCursor = { at: string; id: string };
export type TimelinePage = { items: TimelineItem[]; next: TimelineCursor | null };

/**
 * A person's history, from three places at once: what was logged, what was finished, and what
 * was drafted to them.
 *
 * Merged in the application rather than in SQL. Each source is indexed and over-fetched to the
 * page size, so one chatty source cannot crowd the others out of a page, and the compound
 * cursor keeps paging stable as new rows land on top.
 */
export async function contactTimeline(
  db: Db,
  contactId: string,
  input: { limit?: number; cursor?: TimelineCursor | null } = {},
): Promise<TimelinePage> {
  const limit = input.limit ?? 20;
  const cursor = input.cursor ?? null;

  /**
   * Rows strictly older than the cursor, ties broken by id so nothing repeats or is skipped.
   * Generic over the timestamp and id columns, because the three sources name them differently.
   */
  const olderThan = (at: AnyPgColumn, id: AnyPgColumn): SQL | undefined => {
    if (!cursor) return undefined;
    const when = new Date(cursor.at);
    return or(lt(at, when), and(eq(at, when), lt(id, cursor.id)));
  };

  const [logged, done, drafted] = await Promise.all([
    db
      .select()
      .from(timeline)
      .where(and(eq(timeline.contactId, contactId), olderThan(timeline.createdAt, timeline.id)))
      .orderBy(desc(timeline.createdAt), desc(timeline.id))
      .limit(limit + 1),
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.contactId, contactId),
          eq(tasks.status, "done"),
          isNotNull(tasks.completedAt),
          olderThan(tasks.completedAt, tasks.id),
        ),
      )
      .orderBy(desc(tasks.completedAt), desc(tasks.id))
      .limit(limit + 1),
    db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.contactId, contactId),
          olderThan(approvals.createdAt, approvals.id),
        ),
      )
      .orderBy(desc(approvals.createdAt), desc(approvals.id))
      .limit(limit + 1),
  ]);

  const items: TimelineItem[] = [
    ...logged.map((row) => ({
      id: row.id,
      at: row.createdAt,
      kind: row.kind as TimelineItem["kind"],
      body: row.body,
    })),
    ...done.map((row) => ({
      id: row.id,
      at: row.completedAt ?? row.updatedAt,
      kind: "task_done" as const,
      body: `Done: ${row.title}`,
    })),
    ...drafted.map((row) => ({
      id: row.id,
      at: row.createdAt,
      kind: "approval" as const,
      body: `${row.kind} · ${row.status}`,
      detail: row.failureReason ?? undefined,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1));

  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  const more = items.length > limit;

  return { items: page, next: more && last ? { at: last.at.toISOString(), id: last.id } : null };
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export type BoardDeal = Deal & { contactName: string | null };
export type Board = { pipeline: Pipeline; columns: { stage: string; deals: BoardDeal[] }[] };

export async function listPipelines(db: Db): Promise<Pipeline[]> {
  return db.select().from(pipelines).orderBy(asc(pipelines.name));
}

/** Every pipeline with its deals already in columns. Two queries, not one per stage. */
export async function loadBoards(db: Db): Promise<Board[]> {
  const [allPipelines, allDeals] = await Promise.all([
    listPipelines(db),
    db
      .select({ deal: deals, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(deals)
      .leftJoin(contacts, eq(deals.contactId, contacts.id))
      .orderBy(sql`${deals.nextStepDue} asc nulls first`, desc(deals.valueCents))
      .limit(1000),
  ]);

  const rows: BoardDeal[] = allDeals.map((row) => ({
    ...row.deal,
    contactName: row.firstName ? [row.firstName, row.lastName].filter(Boolean).join(" ") : null,
  }));

  return allPipelines.map((pipeline) => {
    const mine = rows.filter((deal) => deal.pipelineId === pipeline.id);
    const columns = pipeline.stages.map((stage) => ({ stage, deals: mine.filter((deal) => deal.stage === stage) }));

    // A deal standing in a stage the pipeline no longer has would otherwise be invisible.
    const stray = mine.filter((deal) => !pipeline.stages.includes(deal.stage));
    return { pipeline, columns: stray.length > 0 ? [{ stage: "Unsorted", deals: stray }, ...columns] : columns };
  });
}

export async function dealById(db: Db, id: string): Promise<Deal | null> {
  const [row] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  return row ?? null;
}

/** Contacts for a picker: enough to choose by, not the whole record. */
export async function contactOptions(db: Db): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .orderBy(asc(contacts.firstName), asc(contacts.lastName))
    .limit(500);
  return rows.map((row) => ({ id: row.id, name: [row.firstName, row.lastName].filter(Boolean).join(" ") }));
}

export async function dealOptions(db: Db): Promise<{ id: string; name: string }[]> {
  const rows = await db.select({ id: deals.id, title: deals.title }).from(deals).orderBy(asc(deals.title)).limit(500);
  return rows.map((row) => ({ id: row.id, name: row.title }));
}
