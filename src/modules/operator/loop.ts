import type { OperatorClient, Turn, ToolResultBlock, Usage } from "./client";
import { byName, toolSchemas, type AnyTool, type ToolContext } from "./registry";

/** PRD §6.3: up to 8 tool rounds per user message, 60 s overall. */
export const MAX_ROUNDS = 8;
export const TURN_BUDGET_MS = 60_000;

export type ToolCall = {
  name: string;
  /** A one-line summary for the UI. Never the body of a message. */
  summary: string;
  status: "ok" | "error";
  input: unknown;
  output: unknown;
};

export type TurnResult = {
  text: string;
  calls: ToolCall[];
  usage: Usage;
  /** Set when the loop ran out of rounds or time rather than finishing. */
  stopped: "rounds" | "time" | null;
};

export type LoopResult = { ok: true; data: TurnResult } | { ok: false; error: { code: string; message: string } };

/** Keys never summarised: a message body, a note, a practice note. PRD §6.1. */
const PRIVATE_KEYS = new Set(["body", "notes", "note", "subject"]);

/**
 * A tool call as one short line. Scalars only, three at most, and never the contents of
 * something written to a person — the thread shows that in the approval, not in a log line.
 */
export function summariseArgs(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (parts.length === 3) break;
    if (PRIVATE_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    const text = String(value);
    parts.push(`${key}: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`);
  }
  return parts.join(", ");
}

export type RunTurnInput = {
  tools: AnyTool[];
  ctx: ToolContext;
  system: string;
  /** The thread so far, oldest first, already trimmed to the window. */
  history: Turn[];
  text: string;
  /** Called as each tool finishes, so a thread can be persisted while the loop is still running. */
  onToolCall?: (call: ToolCall) => Promise<void>;
  now?: () => number;
};

/**
 * One user message, start to finish.
 *
 * Rounds are capped and the whole turn has a budget. Hitting either stops the loop and says so
 * rather than returning a half-finished answer as though it were a whole one.
 *
 * A tool that refuses is **not** an error here: its refusal goes back to the model as a tool
 * result, which is how the Operator comes to explain "that contact is marked do-not-contact"
 * instead of failing silently. Only the model call itself failing ends the turn.
 */
export async function runTurn(client: OperatorClient, input: RunTurnInput): Promise<LoopResult> {
  const { tools, ctx, system, history, text, onToolCall } = input;
  const clock = input.now ?? (() => Date.now());
  const deadline = clock() + TURN_BUDGET_MS;

  const schemas = toolSchemas(tools);
  const turns: Turn[] = [...history, { role: "user", text }];
  const calls: ToolCall[] = [];
  const usage: Usage = { input: 0, output: 0 };
  let answer = "";

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (clock() >= deadline) return stop(answer, calls, usage, "time");

    let reply;
    try {
      reply = await client.complete({ system, turns, tools: schemas });
    } catch (error) {
      console.error(JSON.stringify({ event: "operator_turn_failed", round, detail: String(error) }));
      return {
        ok: false,
        error: { code: "model_failed", message: "The Operator could not reach the model just now. Try again." },
      };
    }

    usage.input += reply.usage.input;
    usage.output += reply.usage.output;
    if (reply.text.trim()) answer = reply.text.trim();

    if (reply.toolUses.length === 0) {
      return { ok: true, data: { text: answer, calls, usage, stopped: null } };
    }

    turns.push({ role: "assistant", text: reply.text, toolUses: reply.toolUses });

    const results: ToolResultBlock[] = [];
    for (const use of reply.toolUses) {
      const call = await runOne(tools, ctx, use.name, use.input);
      calls.push(call);
      if (onToolCall) await onToolCall(call);
      results.push({ id: use.id, output: call.output, isError: call.status === "error" });
    }
    turns.push({ role: "tool", results });
  }

  return stop(answer, calls, usage, "rounds");
}

function stop(text: string, calls: ToolCall[], usage: Usage, reason: "rounds" | "time"): LoopResult {
  const said =
    reason === "rounds"
      ? "I stopped after the maximum number of steps without finishing. Nothing further was done."
      : "I ran out of time on this one and stopped. Nothing further was done.";
  return { ok: true, data: { text: text ? `${text}\n\n${said}` : said, calls, usage, stopped: reason } };
}

/** One tool call: find it, validate its input, run it, and never let it throw past here. */
async function runOne(tools: AnyTool[], ctx: ToolContext, name: string, raw: unknown): Promise<ToolCall> {
  const summary = summariseArgs(raw);
  const tool = byName(tools, name);
  if (!tool) {
    return { name, summary, status: "error", input: raw, output: { error: `There is no tool called ${name}.` } };
  }

  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "input";
    return {
      name,
      summary,
      status: "error",
      input: raw,
      output: { error: `${where}: ${issue?.message ?? "that input was not valid for this tool."}` },
    };
  }

  try {
    const outcome = await tool.run(ctx, parsed.data);
    if (outcome.ok) return { name, summary, status: "ok", input: parsed.data, output: outcome.data };
    return { name, summary, status: "error", input: parsed.data, output: { error: outcome.error.message } };
  } catch (error) {
    // A throw is a bug, not an answer. The turn survives it and the thread shows it.
    console.error(JSON.stringify({ event: "operator_tool_threw", tool: name, detail: String(error) }));
    return {
      name,
      summary,
      status: "error",
      input: parsed.data,
      output: { error: `${name} failed unexpectedly. Nothing was changed by it.` },
    };
  }
}
