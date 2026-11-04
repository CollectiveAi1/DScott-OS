import { z } from "zod";
import { buildBrief } from "../brief";
import { briefInputs } from "../brief-service";
import { renderBrief } from "../render-brief";
import { ok, type Tool } from "../registry";

/**
 * The whole day in one call, computed the same way the morning brief is.
 *
 * It exists so a question like "what does today look like" costs one tool round instead of five,
 * and so the Operator's answer and the stored brief can never disagree.
 */
export const briefTodayTool: Tool<{ day?: string }> = {
  name: "brief.today",
  description:
    "Everything about a day at once: events by arena, travel, clashes in the next 72 hours, " +
    "tasks due or overdue, deals needing a next step, approvals waiting, the Misc inbox count " +
    "and Family events today and tomorrow. Defaults to today.",
  effect: "read",
  input: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  async run(ctx, input) {
    const day = input.day ?? ctx.today;
    const data = buildBrief(
      await briefInputs(ctx.db, {
        day,
        timeZone: ctx.timeZone,
        now: ctx.now,
        protectedTime: ctx.protectedTime,
      }),
    );
    return ok({ day, data, text: renderBrief(data) });
  },
};

export const BRIEF_TOOLS = [briefTodayTool];
