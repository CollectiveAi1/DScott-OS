import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { tasks } from "@/db/schema";
import { addBusinessDays } from "./dates";
import { formatCents } from "./money";

/**
 * Work the OS hands to someone else on the team. These are tasks **inside** the OS: nothing is
 * sent, nobody is notified, and Ahmad or Kenza find them on their own (PRD §8.6).
 *
 * Both are exactly-once by construction. Each carries a `handoff_key` with a unique index, and
 * the insert is `on conflict do nothing` — so moving a deal out of Deposit and back cannot
 * produce a second invoice task, and neither can two clicks landing at the same moment.
 */

export const BILLING_OWNER = "Ahmad";
export const ONBOARDING_OWNER = "Kenza";
const DUE_IN_BUSINESS_DAYS = 2;

export function invoiceKey(dealId: string, stage: string): string {
  return `invoice:${dealId}:${stage}`;
}

export function onboardKey(contactId: string): string {
  return `onboard:${contactId}`;
}

/** True when the task was created by this call; false when it already existed. */
async function createOnce(
  db: Db,
  values: typeof tasks.$inferInsert & { handoffKey: string },
): Promise<boolean> {
  const rows = await db.insert(tasks).values(values).onConflictDoNothing().returning({ id: tasks.id });
  return rows.length > 0;
}

export async function handoffBilling(
  db: Db,
  input: { dealId: string; title: string; valueCents: number; stage: string; contactId: string | null; today: string },
): Promise<boolean> {
  return createOnce(db, {
    title: `Invoice: ${input.title} (${formatCents(input.valueCents)})`,
    owner: BILLING_OWNER,
    arena: "collective",
    due: addBusinessDays(input.today, DUE_IN_BUSINESS_DAYS),
    dealId: input.dealId,
    contactId: input.contactId,
    createdBy: "automation",
    handoffKey: invoiceKey(input.dealId, input.stage),
  });
}

export async function handoffOnboarding(
  db: Db,
  input: { contactId: string; name: string; today: string },
): Promise<boolean> {
  return createOnce(db, {
    title: `Onboard: ${input.name}`,
    owner: ONBOARDING_OWNER,
    arena: "collective",
    due: addBusinessDays(input.today, DUE_IN_BUSINESS_DAYS),
    contactId: input.contactId,
    createdBy: "automation",
    handoffKey: onboardKey(input.contactId),
  });
}

/** Tasks a handoff created, for showing on a deal or a contact. */
export async function handoffTasksFor(db: Db, dealId: string) {
  return db.select().from(tasks).where(eq(tasks.dealId, dealId));
}
