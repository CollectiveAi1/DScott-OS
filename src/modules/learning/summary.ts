import { renderReview } from "./render";
import type { LearningReview } from "./review";

/** The narrow slice of the model this needs, injected so the path is testable without a key. */
export type SummaryModel = { write(input: { instructions: string; review: string }): Promise<string> };

/** PRD §6 names `claude-haiku-5-5`, which does not exist. This is the real small model. */
export const DEFAULT_SUMMARY_MODEL = "claude-haiku-4-5-20251001";

export function summaryModelName(): string {
  return process.env.SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;
}

export function hasSummaryKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * The model is asked to **phrase**, never to compute.
 *
 * Every number it sees is already resolved, and it is told plainly not to invent one. A weekly
 * review that quietly reported the wrong total would be worse than a plain one, and the plain
 * one is always available.
 */
export const INSTRUCTIONS = [
  "You are rewriting a weekly learning review so it reads well. It is for one person, about",
  "their own practice. Write to them directly, in plain language, in under 180 words.",
  "",
  "Every number, date and title below is already worked out. Use them exactly as given.",
  "Do not calculate anything, do not add a figure that is not here, and do not invent progress",
  "or praise that the numbers do not support. If a week was thin, say so plainly.",
  "",
  "Keep the structure: how the week went, then anything past due or stalled, then the single",
  "next step for each skill. No preamble, no sign-off, no markdown headings.",
].join("\n");

export type Summary = { body: string; source: "offline" | "model" };

/**
 * The review as prose. The deterministic template is the floor: with no key, or on any failure,
 * it is what gets stored, so a review always exists and always has the right numbers in it.
 */
export async function summarise(review: LearningReview, model: SummaryModel | null): Promise<Summary> {
  const offline = renderReview(review);
  if (!model) return { body: offline, source: "offline" };

  try {
    const written = (await model.write({ instructions: INSTRUCTIONS, review: offline })).trim();
    // An empty or truncated reply is not better than the template.
    if (written.length < 20) return { body: offline, source: "offline" };
    return { body: written, source: "model" };
  } catch (error) {
    console.error(JSON.stringify({ event: "learning_summary_failed", detail: String(error) }));
    return { body: offline, source: "offline" };
  }
}

/** The real client. Built only when a key exists. */
export function anthropicSummaryModel(): SummaryModel {
  return {
    async write({ instructions, review }) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });

      const message = await client.messages.create({
        model: summaryModelName(),
        max_tokens: 1000,
        system: instructions,
        messages: [{ role: "user", content: `<review>\n${review}\n</review>` }],
      });

      return message.content
        .filter((block): block is { type: "text"; text: string; citations: never } => block.type === "text")
        .map((block) => block.text)
        .join("");
    },
  };
}
