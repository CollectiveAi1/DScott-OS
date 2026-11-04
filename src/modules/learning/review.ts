import { addDays } from "@/lib/dates";
import { startOfWeek } from "@/lib/zoned";

/** The rows the review reads. Shaped so the function needs no database and no clock. */
export type ReviewSkill = { id: string; name: string; currentLevel: number; targetLevel: number };
export type ReviewItem = {
  id: string;
  skillId: string;
  title: string;
  kind: string;
  status: "queued" | "active" | "done" | "dropped";
  due: string | null;
};
export type ReviewPractice = { skillId: string; day: string; minutes: number };

export type SkillMinutes = {
  skillId: string;
  name: string;
  currentLevel: number;
  targetLevel: number;
  thisWeek: number;
  lastWeek: number;
  /** Days since the last practice, or null if there has never been any. */
  daysSincePractice: number | null;
  nextStep: string;
};

export type FlaggedItem = { itemId: string; title: string; skillName: string; due: string | null };

export type LearningReview = {
  /** The Sunday the review covers, and the Monday–Sunday block it reports on. */
  day: string;
  weekStart: string;
  weekEnd: string;
  totals: { thisWeek: number; lastWeek: number };
  skills: SkillMinutes[];
  stalled: FlaggedItem[];
  pastDue: FlaggedItem[];
};

/** An active item's skill with no practice for this long is stalled. */
export const STALLED_DAYS = 14;

function sumMinutes(practice: ReviewPractice[], skillId: string, from: string, to: string): number {
  return practice
    .filter((row) => row.skillId === skillId && row.day >= from && row.day <= to)
    .reduce((total, row) => total + row.minutes, 0);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The next thing to do for one skill. Exactly one, first match wins — a review that hands back
 * six things is a backlog, and the rest of the OS is already that.
 */
function nextStepFor(
  skill: ReviewSkill,
  items: ReviewItem[],
  stalledSkill: boolean,
  today: string,
): string {
  const mine = items.filter((item) => item.skillId === skill.id);
  const live = mine.filter((item) => item.status === "queued" || item.status === "active");

  const overdue = live.find((item) => item.due !== null && item.due < today);
  if (overdue) return `Finish "${overdue.title}", it was due ${overdue.due}.`;

  const active = live.find((item) => item.status === "active");
  if (active && stalledSkill) return `Get back to "${active.title}".`;
  if (active) return `Keep going on "${active.title}".`;

  const queued = live.find((item) => item.status === "queued");
  if (queued) return `Start "${queued.title}".`;

  if (mine.length > 0) return `Pick something new for ${skill.name}.`;
  return `Add something to learn for ${skill.name}.`;
}

/**
 * The weekly review, as data. Everything downstream — the offline template, the model prompt,
 * the screen — reads this one structure, so there is one place where a number can be wrong.
 *
 * Weeks are Monday–Sunday, matching protected time and the schedule grids. The review lands on
 * a Sunday evening, so "this week" is the week just finished.
 */
export function buildReview(input: {
  today: string;
  skills: ReviewSkill[];
  items: ReviewItem[];
  practice: ReviewPractice[];
}): LearningReview {
  const { today, skills, items, practice } = input;

  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const lastWeekStart = addDays(weekStart, -7);
  const lastWeekEnd = addDays(weekStart, -1);

  const stalledSkillIds = new Set<string>();

  const skillRows: SkillMinutes[] = skills.map((skill) => {
    const thisWeek = sumMinutes(practice, skill.id, weekStart, weekEnd);
    const lastWeek = sumMinutes(practice, skill.id, lastWeekStart, lastWeekEnd);

    const days = practice
      .filter((row) => row.skillId === skill.id && row.minutes > 0 && row.day <= today)
      .map((row) => row.day)
      .sort();
    const latest = days[days.length - 1];
    const daysSincePractice = latest ? daysBetween(latest, today) : null;

    // Never practised counts as stalled too: an active item nobody has ever touched is exactly
    // the thing worth surfacing.
    const stalled = daysSincePractice === null || daysSincePractice >= STALLED_DAYS;
    if (stalled) stalledSkillIds.add(skill.id);

    return {
      skillId: skill.id,
      name: skill.name,
      currentLevel: skill.currentLevel,
      targetLevel: skill.targetLevel,
      thisWeek,
      lastWeek,
      daysSincePractice,
      nextStep: nextStepFor(skill, items, stalled, today),
    };
  });

  const nameOf = new Map(skills.map((skill) => [skill.id, skill.name]));
  const flag = (item: ReviewItem): FlaggedItem => ({
    itemId: item.id,
    title: item.title,
    skillName: nameOf.get(item.skillId) ?? "Unknown skill",
    due: item.due,
  });

  const stalled = items.filter((item) => item.status === "active" && stalledSkillIds.has(item.skillId)).map(flag);

  const pastDue = items
    .filter((item) => item.status !== "done" && item.status !== "dropped" && item.due !== null && item.due < today)
    .map(flag);

  return {
    day: today,
    weekStart,
    weekEnd,
    totals: {
      thisWeek: skillRows.reduce((total, skill) => total + skill.thisWeek, 0),
      lastWeek: skillRows.reduce((total, skill) => total + skill.lastWeek, 0),
    },
    skills: skillRows,
    stalled,
    pastDue,
  };
}
