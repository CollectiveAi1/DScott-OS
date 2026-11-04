/**
 * The one place a model client is built.
 *
 * M5 (schedule extraction), M7 (the weekly review) and M9 (the Operator and the brief) all need
 * one, and three copies of the same constructor is three places a timeout or a retry policy can
 * drift. The prompts and the output handling stay in their own modules — only the client, the
 * model names and the key check live here.
 *
 * **PRD §6 names `claude-sonnet-5-5` and `claude-haiku-5-5`. Neither exists.** The real ids are
 * below, and both are still overridable by env as the PRD intends.
 */
export const DEFAULT_OPERATOR_MODEL = "claude-sonnet-5";
export const DEFAULT_SUMMARY_MODEL = "claude-haiku-4-5-20251001";

/** The big model: the Operator loop, and reading a document it has never seen. */
export function operatorModelName(): string {
  return process.env.OPERATOR_MODEL || DEFAULT_OPERATOR_MODEL;
}

/** The small model: phrasing something already worked out. */
export function summaryModelName(): string {
  return process.env.SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;
}

/**
 * No key is a supported state, not an error. Every path that would use a model checks this and
 * offers the offline version instead — a template brief, a disabled import option, a readable
 * but closed Operator.
 */
export function hasModelKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** LLM calls get 60 s and one retry, per PRD §6.1. */
export const MODEL_TIMEOUT_MS = 60_000;

export async function anthropic() {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: MODEL_TIMEOUT_MS, maxRetries: 1 });
}

/** The text blocks of a reply, joined. Tool-use blocks are handled by the loop, not here. */
export function textOf(content: { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}
