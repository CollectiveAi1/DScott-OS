import { anthropic, hasModelKey, summaryModelName, textOf, DEFAULT_SUMMARY_MODEL } from "@/lib/model";
import { renderReview } from "./render";
import type { LearningReview } from "./review";

/** The narrow slice of the model this needs, injected so the path is testable without a key. */
export type SummaryModel = { write(input: { instructions: string; review: string }): Promise<string> };

// The model id, the name resolution and the client all live in `src/lib/model.ts`, shared with
// M5's extractor and M9's Operator. Re-exported here so this module's callers need one import.
export { DEFAULT_SUMMARY_MODEL, summaryModelName };

export function hasSummaryKey(): boolean {
  return hasModelKey();
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
      const client = await anthropic();
      const message = await client.messages.create({
        model: summaryModelName(),
        max_tokens: 1000,
        system: instructions,
        messages: [{ role: "user", content: `<review>\n${review}\n</review>` }],
      });

      return textOf(message.content);
    },
  };
}
