import type { z } from "zod";
import { toJSONSchema } from "zod";
import type { Db } from "@/db/client";
import type { ProtectedBlock } from "@/db/schema";

/**
 * What a tool is given.
 *
 * Deliberately **no model client**: a tool cannot call a model, and so cannot recurse into the
 * loop that called it. Deliberately no settings *reader* either — the two settings a tool needs
 * (the time zone and the protected blocks) are resolved once by the caller and handed over, so
 * no tool reaches into settings for itself and every tool is testable with a plain object.
 */
export type ToolContext = {
  db: Db;
  timeZone: string;
  today: string;
  now: Date;
  protectedTime: ProtectedBlock[];
};

export type ToolOutcome = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

export type Tool<Input = never> = {
  name: string;
  /** Written for the model: what it does and when to reach for it. */
  description: string;
  /**
   * `read` touches nothing. `write` creates or updates rows.
   *
   * There is no third value. Nothing here deletes a row, sends anything, reaches an external
   * service, or reads or writes settings, `owner` or `encrypted_keys` — and `tests/
   * operator.registry.test.ts` asserts the write set against an explicit list, so a new tool
   * that writes fails the suite until someone adds it there on purpose.
   */
  effect: "read" | "write";
  input: z.ZodType<Input>;
  run(ctx: ToolContext, input: Input): Promise<ToolOutcome>;
};

/** A tool with its input type erased, which is all the dispatcher needs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any>;

export function fail(code: string, message: string): ToolOutcome {
  return { ok: false, error: { code, message } };
}

export function ok(data: unknown): ToolOutcome {
  return { ok: true, data };
}

/** The shape the Anthropic API wants, derived from each tool's zod schema. */
export type ToolSchema = { name: string; description: string; input_schema: Record<string, unknown> };

export function toolSchemas(tools: AnyTool[]): ToolSchema[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toJSONSchema(tool.input, { io: "input", target: "draft-7" }) as Record<string, unknown>,
  }));
}

export function byName(tools: AnyTool[], name: string): AnyTool | null {
  return tools.find((tool) => tool.name === name) ?? null;
}

/** Every tool that can change a row, by name. The list a test pins. */
export function writeToolNames(tools: AnyTool[]): string[] {
  return tools
    .filter((tool) => tool.effect === "write")
    .map((tool) => tool.name)
    .sort();
}
