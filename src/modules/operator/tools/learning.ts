import { z } from "zod";
import { latestDigest, listSkills } from "@/modules/learning/queries";
import { logPractice } from "@/modules/learning/service";
import { fail, ok, type Tool } from "../registry";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30.");

export const learningSummaryTool: Tool<Record<string, never>> = {
  name: "learning.summary",
  description:
    "Every tracked skill with its current and target level and the minutes logged in the last 7 " +
    "and 30 days, plus the most recent weekly review.",
  effect: "read",
  input: z.object({}),
  async run(ctx) {
    const [skills, review] = await Promise.all([
      listSkills(ctx.db, ctx.today),
      latestDigest(ctx.db, "learning_review"),
    ]);
    return ok({
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        currentLevel: skill.currentLevel,
        targetLevel: skill.targetLevel,
        minutes7d: skill.last7,
        minutes30d: skill.last30,
      })),
      latestReview: review ? { day: review.day, body: review.body } : null,
    });
  },
};

export const learningLogPracticeTool: Tool<{ skill: string; minutes: number; day?: string; note?: string | null }> = {
  name: "learning.log_practice",
  description:
    "Log practice against a skill: minutes, optionally a date (defaults to today) and a note. " +
    "The skill is matched by name — call learning.summary first if unsure which exist.",
  effect: "write",
  input: z.object({
    skill: z.string().min(1).max(100).describe("Skill name, as shown in Learning."),
    minutes: z.number().int().min(1).max(1440),
    day: DATE.optional(),
    note: z.string().max(2000).nullish(),
  }),
  async run(ctx, input) {
    const skills = await listSkills(ctx.db, ctx.today);
    const wanted = input.skill.trim().toLowerCase();
    const skill = skills.find((candidate) => candidate.name.toLowerCase() === wanted);
    if (!skill) {
      return fail("no_skill", `There is no skill called "${input.skill}". Skills: ${skills.map((s) => s.name).join(", ") || "none yet"}.`);
    }

    const result = await logPractice(ctx.db, {
      skillId: skill.id,
      day: input.day ?? ctx.today,
      minutes: input.minutes,
      note: input.note ?? null,
    });
    if (!result.ok) return fail(result.error.code, result.error.message);
    return ok({ skill: skill.name, day: result.data.day, minutes: result.data.minutes });
  },
};

export const LEARNING_TOOLS = [learningSummaryTool, learningLogPracticeTool];
