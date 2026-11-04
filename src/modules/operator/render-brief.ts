import { ARENA_LABEL, briefIsEmpty, type BriefData, type BriefDeal, type BriefTask } from "./brief";

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function taskLine(task: BriefTask, day: string): string {
  const late = task.due !== null && task.due < day ? ` (due ${task.due})` : "";
  const flag = task.priority === "high" || task.priority === "urgent" ? ` · ${task.priority}` : "";
  return `- ${task.title}${late}${flag}`;
}

function dealLine(deal: BriefDeal): string {
  const step = deal.nextStep?.trim();
  const tail = step ? `next step "${step}" was due ${deal.nextStepDue}` : "no next step";
  return `- ${deal.title} · ${deal.pipeline} · ${deal.stage} — ${tail}`;
}

/**
 * The brief as text, with no model involved.
 *
 * Deterministic: the same data gives the same words, every time. That is what makes it testable,
 * and it is why this — not the model's version — is the thing that always exists. A brief that
 * only works when an API key does is not a brief you can plan a morning around.
 */
export function renderBrief(data: BriefData): string {
  const lines: string[] = [`Brief · ${data.day}`, ""];

  if (briefIsEmpty(data)) {
    lines.push("Nothing scheduled, nothing due, nothing waiting. A clear day.");
    return lines.join("\n");
  }

  if (data.byArena.length === 0) {
    lines.push("Nothing on the calendar today.");
  } else {
    for (const group of data.byArena) {
      lines.push(`${ARENA_LABEL[group.arena] ?? group.arena}`);
      for (const item of group.items) lines.push(`- ${item.when} · ${item.title}`);
      lines.push("");
    }
  }

  if (data.travel.length > 0) {
    lines.push("Travel");
    for (const item of data.travel) lines.push(`- ${item.title} · ${item.when}`);
    lines.push("");
  }

  if (data.conflicts.length > 0) {
    lines.push(`Conflicts in the next 72 hours (${data.conflicts.length})`);
    // "clashes with" rather than "vs": half these titles are already "Home game vs Dayton".
    for (const clash of data.conflicts) lines.push(`- ${clash.when} · ${clash.left} clashes with ${clash.right}`);
    lines.push("");
  }

  if (data.overdue.length > 0) {
    lines.push(`Overdue (${data.overdue.length})`);
    for (const task of data.overdue) lines.push(taskLine(task, data.day));
    lines.push("");
  }

  if (data.dueToday.length > 0) {
    lines.push(`Due today (${data.dueToday.length})`);
    for (const task of data.dueToday) lines.push(taskLine(task, data.day));
    lines.push("");
  }

  const deals = [...data.deals.overdue, ...data.deals.noNextStep];
  if (deals.length > 0) {
    lines.push(`Deals needing a next step (${deals.length})`);
    for (const deal of deals) lines.push(dealLine(deal));
    lines.push("");
  }

  if (data.family.tomorrow.length > 0) {
    lines.push("Family tomorrow");
    for (const item of data.family.tomorrow) lines.push(`- ${item.when} · ${item.title}`);
    lines.push("");
  }

  const waiting: string[] = [];
  if (data.approvalsWaiting > 0) waiting.push(`${plural(data.approvalsWaiting, "approval")} waiting`);
  if (data.miscInbox > 0) waiting.push(`${plural(data.miscInbox, "capture")} untriaged in Misc`);
  if (waiting.length > 0) lines.push(`${waiting.join(", ")}.`);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}
