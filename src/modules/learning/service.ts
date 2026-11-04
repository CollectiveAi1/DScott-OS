import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { digests, learningItems, practiceLog, skills } from "@/db/schema";
import { reviewInputs } from "./queries";
import { buildReview, type LearningReview, type ReviewItem } from "./review";
import { anthropicSummaryModel, hasSummaryKey, summarise, type SummaryModel } from "./summary";

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

export const LEVELS = [1, 2, 3, 4, 5] as const;
export const ITEM_KINDS = ["course", "book", "video", "project"] as const;
export const ITEM_STATUSES = ["queued", "active", "done", "dropped"] as const;

export type SkillInput = { name: string; currentLevel: number; targetLevel: number; why: string | null };

export async function createSkill(db: Db, input: SkillInput): Promise<Result<typeof skills.$inferSelect>> {
  if (!input.name.trim()) return fail("no_name", "Give the skill a name.");
  const [row] = await db
    .insert(skills)
    .values({
      name: input.name.trim(),
      currentLevel: input.currentLevel,
      targetLevel: input.targetLevel,
      why: input.why,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return fail("duplicate", "A skill with that name is already here.");
  return { ok: true, data: row };
}

export async function updateSkill(db: Db, id: string, input: SkillInput): Promise<Result<typeof skills.$inferSelect>> {
  if (!input.name.trim()) return fail("no_name", "Give the skill a name.");
  const [row] = await db
    .update(skills)
    .set({
      name: input.name.trim(),
      currentLevel: input.currentLevel,
      targetLevel: input.targetLevel,
      why: input.why,
    })
    .where(eq(skills.id, id))
    .returning();
  if (!row) return fail("not_found", "That skill is no longer there.");
  return { ok: true, data: row };
}

export async function deleteSkill(db: Db, id: string): Promise<Result<{ id: string }>> {
  // Items and practice cascade: the record of a skill goes with the skill.
  const [row] = await db.delete(skills).where(eq(skills.id, id)).returning({ id: skills.id });
  if (!row) return fail("not_found", "That skill is no longer there.");
  return { ok: true, data: row };
}

export type ItemInput = {
  skillId: string;
  title: string;
  kind: (typeof ITEM_KINDS)[number];
  status: (typeof ITEM_STATUSES)[number];
  due: string | null;
  url: string | null;
};

export async function createItem(db: Db, input: ItemInput): Promise<Result<typeof learningItems.$inferSelect>> {
  if (!input.title.trim()) return fail("no_title", "Give it a title.");
  const [row] = await db
    .insert(learningItems)
    .values({ ...input, title: input.title.trim() })
    .returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");
  return { ok: true, data: row };
}

export async function updateItem(db: Db, id: string, input: Omit<ItemInput, "skillId">): Promise<Result<typeof learningItems.$inferSelect>> {
  if (!input.title.trim()) return fail("no_title", "Give it a title.");
  const [row] = await db
    .update(learningItems)
    .set({ ...input, title: input.title.trim() })
    .where(eq(learningItems.id, id))
    .returning();
  if (!row) return fail("not_found", "That item is no longer there.");
  return { ok: true, data: row };
}

export async function deleteItem(db: Db, id: string): Promise<Result<{ id: string }>> {
  const [row] = await db.delete(learningItems).where(eq(learningItems.id, id)).returning({ id: learningItems.id });
  if (!row) return fail("not_found", "That item is no longer there.");
  return { ok: true, data: row };
}

/**
 * Practice is additive. Two sessions on one day are two rows: a day's total is their sum, and
 * logging a second session never quietly replaces the first.
 */
export async function logPractice(
  db: Db,
  input: { skillId: string; day: string; minutes: number; note: string | null },
): Promise<Result<typeof practiceLog.$inferSelect>> {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    return fail("bad_minutes", "Log at least one minute.");
  }
  if (input.minutes > 24 * 60) return fail("bad_minutes", "That is more than a day.");

  const [row] = await db.insert(practiceLog).values(input).returning();
  if (!row) return fail("not_saved", "That did not save. Try again.");
  return { ok: true, data: row };
}

export async function deletePractice(db: Db, id: string): Promise<Result<{ id: string }>> {
  const [row] = await db.delete(practiceLog).where(eq(practiceLog.id, id)).returning({ id: practiceLog.id });
  if (!row) return fail("not_found", "That entry is no longer there.");
  return { ok: true, data: row };
}

export type WrittenReview = { review: LearningReview; body: string; source: "offline" | "model" };

/**
 * Compute, phrase, store. One row per day: a retry, a manual run and the Sunday tick all land
 * on the same `(kind, day)` and update it rather than accumulating.
 */
export async function writeLearningReview(
  db: Db,
  today: string,
  model: SummaryModel | null = hasSummaryKey() ? anthropicSummaryModel() : null,
): Promise<Result<WrittenReview>> {
  const { allSkills, allItems, practice } = await reviewInputs(db, today);

  const review = buildReview({
    today,
    skills: allSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      currentLevel: skill.currentLevel,
      targetLevel: skill.targetLevel,
    })),
    items: allItems.map(
      (item): ReviewItem => ({
        id: item.id,
        skillId: item.skillId,
        title: item.title,
        kind: item.kind,
        status: item.status,
        due: item.due,
      }),
    ),
    practice,
  });

  const summary = await summarise(review, model);

  const [row] = await db
    .insert(digests)
    .values({
      kind: "learning_review",
      day: today,
      body: summary.body,
      source: summary.source,
      data: review as unknown as Record<string, unknown>,
      createdBy: "automation",
    })
    .onConflictDoUpdate({
      target: [digests.kind, digests.day],
      set: { body: summary.body, source: summary.source, data: review as unknown as Record<string, unknown>, updatedAt: new Date() },
    })
    .returning();
  if (!row) return fail("not_saved", "The review did not save. Try again.");

  return { ok: true, data: { review, body: summary.body, source: summary.source } };
}
