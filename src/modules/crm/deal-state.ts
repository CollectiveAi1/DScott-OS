/** What a deal card has to say about itself, from PRD §8.6's next-step discipline. */
export type DealState =
  | { kind: "ok" }
  | { kind: "no_next_step"; label: "No next step" }
  | { kind: "overdue"; label: "Overdue" };

/**
 * A deal with no next step, or one whose next step is past due, is the thing this screen exists
 * to catch. PRD §11 wants every open deal carrying a dated next step each Monday, and a board
 * that looked calm while deals went quiet would be worse than no board.
 */
export function dealState(deal: { nextStep: string | null; nextStepDue: string | null }, today: string): DealState {
  if (!deal.nextStep?.trim()) return { kind: "no_next_step", label: "No next step" };
  // A next step with no date is still a next step; only a dated one can be late.
  if (deal.nextStepDue && deal.nextStepDue < today) return { kind: "overdue", label: "Overdue" };
  return { kind: "ok" };
}

export function needsAttention(state: DealState): boolean {
  return state.kind !== "ok";
}
