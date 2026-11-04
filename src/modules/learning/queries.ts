import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { digests, learningItems, practiceLog, skills } from "@/db/schema";
import { addDays } from "@/lib/dates";

export type Skill = typeof skills.$inferSelect;
export type LearningItem = typeof learningItems.$inferSelect;
export type PracticeRow = typeof practiceLog.$inferSelect;
export type Digest = typeof digests.$inferSelect;

export type SkillSummary = Skill & { last7: number; last30: number };

/**
 * Skills with the only numbers that tell the truth about them: minutes actually logged. One
 * grouped query rather than two per skill.
 */
export async function listSkills(db: Db, today: string): Promise<SkillSummary[]> {
  const from30 = addDays(today, -29);
  const from7 = addDays(today, -6);

  const [rows, totals] = await Promise.all([
    db.select().from(skills).orderBy(asc(skills.name)),
    db
      .select({
        skillId: practiceLog.skillId,
        last7: sql<number>`coalesce(sum(${practiceLog.minutes}) filter (where ${practiceLog.day} >= ${from7}), 0)`.mapWith(Number),
        last30: sql<number>`coalesce(sum(${practiceLog.minutes}), 0)`.mapWith(Number),
      })
      .from(practiceLog)
      // The window is inclusive of today, so practice logged today counts immediately.
      .where(and(gte(practiceLog.day, from30), sql`${practiceLog.day} <= ${today}`))
      .groupBy(practiceLog.skillId),
  ]);

  const bySkill = new Map(totals.map((row) => [row.skillId, row]));
  return rows.map((skill) => ({
    ...skill,
    last7: bySkill.get(skill.id)?.last7 ?? 0,
    last30: bySkill.get(skill.id)?.last30 ?? 0,
  }));
}

export async function skillById(db: Db, id: string): Promise<Skill | null> {
  const [row] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
  return row ?? null;
}

export async function itemsForSkill(db: Db, skillId: string): Promise<LearningItem[]> {
  return db
    .select()
    .from(learningItems)
    .where(eq(learningItems.skillId, skillId))
    .orderBy(sql`${learningItems.due} asc nulls last`, asc(learningItems.title));
}

export async function practiceForSkill(db: Db, skillId: string, limit = 60): Promise<PracticeRow[]> {
  return db
    .select()
    .from(practiceLog)
    .where(eq(practiceLog.skillId, skillId))
    .orderBy(desc(practiceLog.day), desc(practiceLog.createdAt))
    .limit(limit);
}

/** Everything the review needs, in three reads. */
export async function reviewInputs(db: Db, today: string) {
  // Two full weeks back covers this week and last; the stalled window needs a fortnight too.
  const from = addDays(today, -35);
  const [allSkills, allItems, practice] = await Promise.all([
    db.select().from(skills).orderBy(asc(skills.name)),
    db.select().from(learningItems),
    db
      .select({ skillId: practiceLog.skillId, day: practiceLog.day, minutes: practiceLog.minutes })
      .from(practiceLog)
      .where(gte(practiceLog.day, from)),
  ]);
  return { allSkills, allItems, practice };
}

export async function latestDigest(db: Db, kind: "daily_brief" | "learning_review"): Promise<Digest | null> {
  const [row] = await db.select().from(digests).where(eq(digests.kind, kind)).orderBy(desc(digests.day)).limit(1);
  return row ?? null;
}
