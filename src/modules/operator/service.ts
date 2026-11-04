import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { operatorMessages, operatorThreads, type ProtectedBlock } from "@/db/schema";
import { hasModelKey } from "@/lib/model";
import { anthropicOperatorClient, type OperatorClient, type Turn } from "./client";
import { runTurn, type ToolCall } from "./loop";
import { PROMPT_VERSION, systemPrompt } from "./prompt";
import { CONTEXT_MESSAGES, threadMessages, todaySnapshot, type Message } from "./queries";
import { TOOLS } from "./tools";

export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function fail(code: string, message: string): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code, message } };
}

export const OFFLINE_MESSAGE = "Add ANTHROPIC_API_KEY to enable the Operator.";

/**
 * A thread's name, from the first thing Devon said.
 *
 * Deterministic and free. Cut at a word boundary where there is one, so a title reads like a
 * phrase rather than a truncation.
 */
export function threadTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "Untitled";
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The thread so far, as context — **text only, with earlier tool calls named rather than
 * replayed as blocks.**
 *
 * A `tool_use` block whose matching `tool_result` has fallen outside the 30-message window is an
 * API error, and stitching pairs back together across a truncation is a reliable way to produce
 * one. The record of what ran is kept in full on the thread and shown on the screen; what the
 * model gets is the conversation plus a note of which tools were used. It loses very little: the
 * assistant's own words already say what it did.
 */
export function historyFrom(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  let pendingTools: string[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      pendingTools.push(`${message.toolName ?? "tool"} (${message.toolStatus ?? "ok"})`);
      continue;
    }
    const text = String((message.content as { text?: unknown }).text ?? "").trim();
    if (message.role === "user") {
      pendingTools = [];
      if (text) turns.push({ role: "user", text });
      continue;
    }
    const used = pendingTools.length > 0 ? `\n\n[tools used: ${pendingTools.join(", ")}]` : "";
    pendingTools = [];
    if (text || used) turns.push({ role: "assistant", text: `${text}${used}`.trim(), toolUses: [] });
  }

  // Anthropic requires the first turn to be from the user.
  while (turns.length > 0 && turns[0]?.role !== "user") turns.shift();
  return turns;
}

export type SentTurn = { threadId: string; text: string; calls: ToolCall[] };

/**
 * One user message, answered.
 *
 * Rows are written as they happen — the user's message first, then each tool call as it
 * finishes, then the assistant's answer. A turn that dies halfway leaves a thread that honestly
 * shows what ran, rather than a gap.
 */
export async function sendMessage(
  db: Db,
  input: {
    threadId: string | null;
    text: string;
    timeZone: string;
    today: string;
    now?: Date;
    /** Resolved by the caller, so nothing below this line reads settings for itself. */
    protectedTime: ProtectedBlock[];
  },
  client: OperatorClient | null = hasModelKey() ? anthropicOperatorClient() : null,
): Promise<Result<SentTurn>> {
  const text = input.text.trim();
  if (!text) return fail("empty", "Write something first.");
  if (!client) return fail("offline", OFFLINE_MESSAGE);

  const now = input.now ?? new Date();

  let threadId = input.threadId;
  if (threadId) {
    const [existing] = await db.select({ id: operatorThreads.id }).from(operatorThreads).where(eq(operatorThreads.id, threadId)).limit(1);
    if (!existing) return fail("no_thread", "That thread is no longer there.");
  } else {
    const [created] = await db.insert(operatorThreads).values({ title: threadTitle(text) }).returning();
    if (!created) return fail("not_saved", "That thread did not start. Try again.");
    threadId = created.id;
  }

  const existing = await threadMessages(db, threadId);
  const history = historyFrom(existing.slice(-CONTEXT_MESSAGES));

  await db.insert(operatorMessages).values({ threadId, role: "user", content: { text } });

  const snapshot = await todaySnapshot(db, input.today, input.timeZone, now);
  const result = await runTurn(client, {
    tools: TOOLS,
    ctx: { db, timeZone: input.timeZone, today: input.today, now, protectedTime: input.protectedTime },
    system: systemPrompt(snapshot),
    history,
    text,
    onToolCall: async (call) => {
      await db.insert(operatorMessages).values({
        threadId,
        role: "tool",
        toolName: call.name,
        toolStatus: call.status,
        content: { summary: call.summary, input: call.input, output: call.output },
      });
    },
  });

  // The thread is touched either way: a failed turn still happened, and the user's message is
  // still in it so the retry is one press.
  await db.update(operatorThreads).set({ updatedAt: now }).where(eq(operatorThreads.id, threadId));

  if (!result.ok) return fail(result.error.code, result.error.message);

  await db.insert(operatorMessages).values({
    threadId,
    role: "assistant",
    content: {
      text: result.data.text,
      usage: result.data.usage,
      promptVersion: PROMPT_VERSION,
      stopped: result.data.stopped,
    },
  });

  return { ok: true, data: { threadId, text: result.data.text, calls: result.data.calls } };
}
