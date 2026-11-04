import { z } from "zod";
import { formatCents } from "@/modules/crm/money";
import { loadBoards } from "@/modules/crm/queries";
import { moveDeal } from "@/modules/crm/service";
import { fail, ok, type Tool, type ToolContext } from "../registry";

type Row = {
  id: string;
  title: string;
  pipeline: string;
  stage: string;
  value: string;
  contact: string | null;
  nextStep: string | null;
  nextStepDue: string | null;
  owner: string;
};

async function allDeals(ctx: ToolContext): Promise<{ rows: Row[]; pipelines: { name: string; stages: string[] }[] }> {
  const boards = await loadBoards(ctx.db);
  const rows = boards.flatMap((board) =>
    board.columns.flatMap((column) =>
      column.deals.map((deal) => ({
        id: deal.id,
        title: deal.title,
        pipeline: board.pipeline.name,
        stage: deal.stage,
        value: formatCents(deal.valueCents),
        contact: deal.contactName,
        nextStep: deal.nextStep,
        nextStepDue: deal.nextStepDue,
        owner: deal.owner,
      })),
    ),
  );
  return { rows, pipelines: boards.map((board) => ({ name: board.pipeline.name, stages: board.pipeline.stages })) };
}

export const dealsPipelineSummaryTool: Tool<{ pipeline?: string }> = {
  name: "deals.pipeline_summary",
  description: "Every pipeline, its stages, and how many deals and how much value sit in each stage.",
  effect: "read",
  input: z.object({ pipeline: z.string().max(100).optional() }),
  async run(ctx, input) {
    const boards = await loadBoards(ctx.db);
    const wanted = input.pipeline?.trim().toLowerCase();
    const chosen = wanted ? boards.filter((board) => board.pipeline.name.toLowerCase() === wanted) : boards;
    if (wanted && chosen.length === 0) {
      return fail("no_pipeline", `There is no pipeline called "${input.pipeline}". Pipelines: ${boards.map((b) => b.pipeline.name).join(", ")}.`);
    }

    return ok({
      pipelines: chosen.map((board) => ({
        name: board.pipeline.name,
        stages: board.columns.map((column) => ({
          stage: column.stage,
          deals: column.deals.length,
          value: formatCents(column.deals.reduce((total, deal) => total + deal.valueCents, 0)),
        })),
      })),
    });
  },
};

export const dealsStaleTool: Tool<{ pipeline?: string }> = {
  name: "deals.stale",
  description:
    "Deals that need attention: no next step at all, or a next step whose due date has passed. " +
    "This is the next-step discipline the pipelines screen shows in red.",
  effect: "read",
  input: z.object({ pipeline: z.string().max(100).optional() }),
  async run(ctx, input) {
    const { rows } = await allDeals(ctx);
    const wanted = input.pipeline?.trim().toLowerCase();
    const scope = wanted ? rows.filter((row) => row.pipeline.toLowerCase() === wanted) : rows;

    const noNextStep = scope.filter((row) => !row.nextStep?.trim());
    const overdue = scope.filter(
      (row) => Boolean(row.nextStep?.trim()) && row.nextStepDue !== null && row.nextStepDue < ctx.today,
    );
    return ok({ noNextStep, overdue, count: noNextStep.length + overdue.length });
  },
};

export const dealsMoveStageTool: Tool<{ id: string; stage: string }> = {
  name: "deals.move_stage",
  description:
    "Move a deal to another stage of its own pipeline. This writes a stage_move to the timeline, " +
    "and a stage the pipeline bills on also creates the invoice task for Ahmad — once per deal " +
    "per stage, never twice.",
  effect: "write",
  input: z.object({ id: z.string().uuid(), stage: z.string().min(1).max(100) }),
  async run(ctx, input) {
    const result = await moveDeal(ctx.db, input.id, input.stage, ctx.today);
    if (!result.ok) return fail(result.error.code, result.error.message);
    return ok({ id: result.data.id, title: result.data.title, stage: result.data.stage });
  },
};

export const DEAL_TOOLS = [dealsPipelineSummaryTool, dealsStaleTool, dealsMoveStageTool];
