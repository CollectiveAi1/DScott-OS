import type { LearningReview } from "./review";

/** Minutes as a person says them: 45m, 1h 30m, 2h. */
export function formatMinutes(minutes: number): string {
  if (minutes === 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** "up 30m on last week", "down 15m", "the same as last week". */
function change(thisWeek: number, lastWeek: number): string {
  const delta = thisWeek - lastWeek;
  if (delta === 0) return lastWeek === 0 ? "nothing either week" : "the same as last week";
  return delta > 0 ? `up ${formatMinutes(delta)} on last week` : `down ${formatMinutes(-delta)} on last week`;
}

/**
 * The review as text, with no model involved.
 *
 * Deterministic: the same data gives the same words, every time. That is what makes it testable,
 * and it is why this — not the model's version — is the thing that always exists. Every number
 * here is interpolated from the computed review, never written by anything else.
 */
export function renderReview(review: LearningReview): string {
  const lines: string[] = [];

  lines.push(`Learning review · week of ${review.weekStart} to ${review.weekEnd}`);
  lines.push("");

  if (review.skills.length === 0) {
    lines.push("No skills are being tracked yet. Add one and the next review will have something to say.");
    return lines.join("\n");
  }

  lines.push(
    `You logged ${formatMinutes(review.totals.thisWeek)} this week, ${change(
      review.totals.thisWeek,
      review.totals.lastWeek,
    )}.`,
  );
  lines.push("");

  lines.push("Time per skill");
  for (const skill of review.skills) {
    const level = `level ${skill.currentLevel} of ${skill.targetLevel}`;
    lines.push(
      `- ${skill.name} (${level}): ${formatMinutes(skill.thisWeek)} this week, ${change(skill.thisWeek, skill.lastWeek)}.`,
    );
  }
  lines.push("");

  if (review.pastDue.length > 0) {
    lines.push("Past due");
    for (const flagged of review.pastDue) {
      lines.push(`- ${flagged.title} (${flagged.skillName}) was due ${flagged.due}.`);
    }
    lines.push("");
  }

  if (review.stalled.length > 0) {
    lines.push("Stalled");
    for (const flagged of review.stalled) {
      lines.push(`- ${flagged.title}: ${flagged.skillName} has had no practice in two weeks.`);
    }
    lines.push("");
  }

  lines.push("Next step for each skill");
  for (const skill of review.skills) {
    lines.push(`- ${skill.name}: ${skill.nextStep}`);
  }

  return lines.join("\n").trimEnd();
}
