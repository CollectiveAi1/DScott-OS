import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, contacts } from "@/db/schema";
import type { ApprovalStatus } from "./machine";
import type { Approval } from "./service";

export const TABS = ["waiting", "scheduled", "failed", "history"] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = {
  waiting: "Waiting",
  scheduled: "Scheduled",
  failed: "Failed",
  history: "History",
};

/** History is everything already decided, newest first. */
const STATUSES: Record<Tab, ApprovalStatus[]> = {
  waiting: ["waiting"],
  scheduled: ["scheduled", "sending"],
  failed: ["failed"],
  history: ["sent", "rejected"],
};

export function isTab(value: unknown): value is Tab {
  return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

export type ApprovalRow = Approval & { contactName: string | null };

export async function listApprovals(db: Db, tab: Tab, limit = 100): Promise<ApprovalRow[]> {
  const rows = await db
    .select({ approval: approvals, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(approvals)
    .leftJoin(contacts, eq(approvals.contactId, contacts.id))
    .where(inArray(approvals.status, STATUSES[tab]))
    .orderBy(tab === "history" ? desc(approvals.decidedAt) : sql`${approvals.createdAt} asc`)
    .limit(limit);

  return rows.map((row) => ({
    ...row.approval,
    contactName: row.firstName ? [row.firstName, row.lastName].filter(Boolean).join(" ") : null,
  }));
}

export type TabCounts = Record<Tab, number>;

/** One grouped query for every tab's badge. */
export async function tabCounts(db: Db): Promise<TabCounts> {
  const rows = await db.select({ status: approvals.status, n: count() }).from(approvals).groupBy(approvals.status);
  const byStatus = new Map(rows.map((row) => [row.status, row.n]));
  const total = (tab: Tab) => STATUSES[tab].reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);

  return { waiting: total("waiting"), scheduled: total("scheduled"), failed: total("failed"), history: total("history") };
}

/** What Command's "Waiting for approval" tile counts — the same number the Waiting tab shows. */
export async function waitingCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(approvals).where(eq(approvals.status, "waiting"));
  return row?.n ?? 0;
}

export async function approvalById(db: Db, id: string): Promise<Approval | null> {
  const [row] = await db.select().from(approvals).where(and(eq(approvals.id, id))).limit(1);
  return row ?? null;
}
