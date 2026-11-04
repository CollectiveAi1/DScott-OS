import { anthropic, operatorModelName, textOf } from "@/lib/model";
import type { ToolSchema } from "./registry";

export type ToolUse = { id: string; name: string; input: unknown };

export type ToolResultBlock = { id: string; output: unknown; isError: boolean };

/**
 * One exchange in a thread, in the loop's own shape rather than the SDK's.
 *
 * Keeping this shape ours means the loop is testable with a plain object stub and that a change
 * in the SDK touches one file.
 */
export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolUses: ToolUse[] }
  | { role: "tool"; results: ToolResultBlock[] };

export type Usage = { input: number; output: number };

export type ModelReply = { text: string; toolUses: ToolUse[]; usage: Usage; stopReason: string | null };

/** The narrow slice of the model the loop uses, injected so the loop is tested without a key. */
export type OperatorClient = {
  complete(input: { system: string; turns: Turn[]; tools: ToolSchema[] }): Promise<ModelReply>;
};

export const MAX_TOKENS = 4000;

/** The real client. Built only when a key exists; otherwise the Operator is closed, not broken. */
export function anthropicOperatorClient(): OperatorClient {
  return {
    async complete({ system, turns, tools }) {
      const client = await anthropic();
      const message = await client.messages.create({
        model: operatorModelName(),
        max_tokens: MAX_TOKENS,
        system,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema as { type: "object" },
        })),
        messages: turns.map(toApiMessage),
      });

      return {
        text: textOf(message.content),
        toolUses: message.content
          .filter((block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use")
          .map((block) => ({ id: block.id, name: block.name, input: block.input })),
        usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
        stopReason: message.stop_reason ?? null,
      };
    },
  };
}

/**
 * A turn as the API wants it.
 *
 * Tool output goes in a `tool_result` block as JSON — **wrapped as data, never spliced into the
 * prompt as prose** (PRD §6.3). A contact note that reads like an instruction arrives as the
 * value of a field, which is what it is.
 */
function toApiMessage(turn: Turn) {
  if (turn.role === "user") {
    return { role: "user" as const, content: [{ type: "text" as const, text: turn.text }] };
  }
  if (turn.role === "assistant") {
    const content = [
      ...(turn.text.trim() ? [{ type: "text" as const, text: turn.text }] : []),
      ...turn.toolUses.map((use) => ({
        type: "tool_use" as const,
        id: use.id,
        name: use.name,
        input: (use.input ?? {}) as Record<string, unknown>,
      })),
    ];
    return { role: "assistant" as const, content };
  }
  return {
    role: "user" as const,
    content: turn.results.map((result) => ({
      type: "tool_result" as const,
      tool_use_id: result.id,
      content: JSON.stringify(result.output),
      is_error: result.isError,
    })),
  };
}
