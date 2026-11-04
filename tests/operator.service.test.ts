import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import {
  approvals,
  calendarEvents,
  contacts,
  digests,
  operatorMessages,
  operatorThreads,
  tasks,
} from "../src/db/schema";
import { zonedTimeToInstant } from "../src/lib/zoned";
import type { ModelReply, OperatorClient } from "../src/modules/operator/client";
import { writeDailyBrief, type BriefModel } from "../src/modules/operator/brief-service";
import { OFFLINE_MESSAGE, historyFrom, sendMessage, threadTitle } from "../src/modules/operator/service";
import { threadMessages, tokenUsage } from "../src/modules/operator/queries";
import { freshDb } from "./helpers/db";

const NY = "America/New_York";
const TODAY = "2026-11-10";
const NOW = zonedTimeToInstant(TODAY, "07:00", NY);

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.delete(operatorMessages);
  await db.delete(operatorThreads);
  await db.delete(digests);
  await db.delete(approvals);
  await db.delete(contacts);
  await db.delete(calendarEvents);
  await db.delete(tasks);
});

function reply(partial: Partial<ModelReply>): ModelReply {
  return { text: "", toolUses: [], usage: { input: 100, output: 20 }, stopReason: null, ...partial };
}

function scripted(replies: ModelReply[]): OperatorClient {
  let index = 0;
  return {
    async complete() {
      const next = replies[index++];
      if (!next) throw new Error("the stub ran out of scripted replies");
      return next;
    },
  };
}

const send = (text: string, client: OperatorClient | null, threadId: string | null = null) =>
  sendMessage(db, { threadId, text, timeZone: NY, today: TODAY, now: NOW, protectedTime: [] }, client);

describe("threadTitle", () => {
  it("uses the first message, collapsed to one line", () => {
    expect(threadTitle("  Put film review\n  on Thursday  ")).toBe("Put film review on Thursday");
  });

  it("cuts a long one back to the last word", () => {
    const title = threadTitle("Draft the Brightstart pilot quote and the onboarding note for Kenza to review");
    expect(title).toBe("Draft the Brightstart pilot quote and the onboarding note…");
  });

  it("cuts mid-word rather than throwing most of it away when the only space is early", () => {
    // Cutting back to a boundary 20 characters in would leave a title that says nothing.
    const title = threadTitle(`${"a".repeat(20)} ${"b".repeat(80)}`);
    expect(title).toHaveLength(61);
    expect(title.endsWith("…")).toBe(true);
  });

  it("never returns an empty title", () => {
    expect(threadTitle("   ")).toBe("Untitled");
  });
});

describe("sendMessage, offline", () => {
  it("refuses with the one-line reason and writes nothing", async () => {
    const result = await send("What does today look like?", null);
    expect(result).toEqual({ ok: false, error: { code: "offline", message: OFFLINE_MESSAGE } });
    expect(await db.select().from(operatorThreads)).toHaveLength(0);
  });

  it("refuses an empty message", async () => {
    const result = await send("   ", scripted([reply({ text: "x" })]));
    expect(result.ok).toBe(false);
  });
});

describe("sendMessage, a whole turn", () => {
  it("starts a thread, records the exchange, and names the tool that ran", async () => {
    const result = await send(
      "Put film review Thursday at 7pm for basketball",
      scripted([
        reply({
          toolUses: [
            {
              id: "u1",
              name: "schedule.create_event",
              input: {
                title: "Film review",
                arena: "basketball",
                kind: "team_event",
                date: "2026-11-12",
                start: "19:00",
                end: "20:00",
              },
            },
          ],
        }),
        reply({ text: "Film review is on Thursday 12 November, 19:00 to 20:00." }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.calls.map((call) => `${call.name}:${call.status}`)).toEqual(["schedule.create_event:ok"]);

    const [event] = await db.select().from(calendarEvents);
    expect(event).toMatchObject({ title: "Film review", createdBy: "operator", source: "manual" });

    const rows = await threadMessages(db, result.data.threadId);
    expect(rows.map((row) => row.role)).toEqual(["user", "tool", "assistant"]);
    expect(rows[1]).toMatchObject({ toolName: "schedule.create_event", toolStatus: "ok" });

    const [thread] = await db.select().from(operatorThreads);
    expect(thread?.title).toBe("Put film review Thursday at 7pm for basketball");
  });

  it("drafts a text as a waiting approval and never claims it was sent", async () => {
    const [contact] = await db
      .insert(contacts)
      .values({ firstName: "Kenza", phone: "+1 555 0100", types: ["Team"] })
      .returning();

    const result = await send(
      "Text Kenza that onboarding for Brightstart is ready",
      scripted([
        reply({
          toolUses: [
            {
              id: "u1",
              name: "messages.draft",
              input: { kind: "text", contactId: contact!.id, body: "Onboarding for Brightstart is ready." },
            },
          ],
        }),
        reply({ text: "Drafted. It is waiting for your approval in Approvals." }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).not.toMatch(/\bsent\b/i);
    expect(result.data.text).toContain("waiting");

    const [approval] = await db.select().from(approvals);
    expect(approval).toMatchObject({ status: "waiting", kind: "text", createdBy: "operator" });
  });

  it("never puts a message body in the tool summary", async () => {
    const [contact] = await db.insert(contacts).values({ firstName: "Kenza", phone: "+1 555 0100" }).returning();
    const result = await send(
      "Text Kenza",
      scripted([
        reply({
          toolUses: [
            { id: "u1", name: "messages.draft", input: { kind: "text", contactId: contact!.id, body: "A private thing." } },
          ],
        }),
        reply({ text: "Waiting for approval." }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await threadMessages(db, result.data.threadId);
    const tool = rows.find((row) => row.role === "tool");
    expect((tool?.content as { summary: string }).summary).not.toContain("private");
  });

  it("keeps the user's message and leaves no assistant row when the model fails", async () => {
    const broken: OperatorClient = {
      async complete() {
        throw new Error("503");
      },
    };
    const result = await send("Anything", broken);
    expect(result.ok).toBe(false);

    const [thread] = await db.select().from(operatorThreads);
    const rows = await threadMessages(db, thread!.id);
    expect(rows.map((row) => row.role)).toEqual(["user"]);
  });

  it("shows a tool error in the thread and changes nothing", async () => {
    const [contact] = await db
      .insert(contacts)
      .values({ firstName: "Rosa", email: "rosa@example.com", doNotContact: true })
      .returning();

    const result = await send(
      "Email Rosa the quote",
      scripted([
        reply({
          toolUses: [
            { id: "u1", name: "messages.draft", input: { kind: "email", contactId: contact!.id, subject: "Quote", body: "Here." } },
          ],
        }),
        reply({ text: "Rosa is marked do-not-contact, so I did not draft anything." }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.calls[0]?.status).toBe("error");
    expect(await db.select().from(approvals)).toHaveLength(0);

    const rows = await threadMessages(db, result.data.threadId);
    expect(rows.find((row) => row.role === "tool")).toMatchObject({ toolStatus: "error" });
  });

  it("continues an existing thread and does not start a second one", async () => {
    const first = await send("One", scripted([reply({ text: "Done." })]));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await send("Two", scripted([reply({ text: "Also done." })]), first.data.threadId);
    expect(await db.select().from(operatorThreads)).toHaveLength(1);

    const rows = await threadMessages(db, first.data.threadId);
    expect(rows.map((row) => String((row.content as { text?: string }).text))).toEqual(["One", "Done.", "Two", "Also done."]);
  });

  it("says plainly when the thread is gone", async () => {
    const result = await send("Hello", scripted([reply({ text: "x" })]), "11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("That thread is no longer there.");
  });

  it("records usage and the prompt version on the assistant row", async () => {
    const result = await send("Hello", scripted([reply({ text: "Hi." })]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [assistant] = await db
      .select()
      .from(operatorMessages)
      .where(eq(operatorMessages.role, "assistant"))
      .orderBy(asc(operatorMessages.createdAt));
    const content = assistant?.content as { usage: { input: number }; promptVersion: string };
    expect(content.usage).toEqual({ input: 100, output: 20 });
    expect(content.promptVersion).toMatch(/^\d{4}-\d{2}-\d{2}/);

    // Rows are stamped by the database's own clock, not the scenario's fictional date.
    const usage = await tokenUsage(db, new Date("2000-01-01T00:00:00Z"));
    expect(usage).toEqual({ input: 100, output: 20, turns: 1 });
  });
});

describe("historyFrom", () => {
  it("names earlier tool calls instead of replaying them as blocks", () => {
    const turns = historyFrom([
      { role: "user", content: { text: "Put it on Thursday" } },
      { role: "tool", toolName: "schedule.create_event", toolStatus: "ok", content: {} },
      { role: "assistant", content: { text: "Done." } },
    ] as never);

    expect(turns).toEqual([
      { role: "user", text: "Put it on Thursday" },
      { role: "assistant", text: "Done.\n\n[tools used: schedule.create_event (ok)]", toolUses: [] },
    ]);
  });

  it("drops a leading assistant turn, which the API will not take", () => {
    const turns = historyFrom([
      { role: "assistant", content: { text: "Orphan" } },
      { role: "user", content: { text: "Hello" } },
    ] as never);
    expect(turns.map((turn) => turn.role)).toEqual(["user"]);
  });

  it("skips a message with no text at all", () => {
    expect(historyFrom([{ role: "user", content: {} }] as never)).toEqual([]);
  });
});

describe("writeDailyBrief", () => {
  const scope = { day: TODAY, timeZone: NY, now: NOW, protectedTime: [] };

  it("writes the deterministic template when there is no model", async () => {
    await db.insert(tasks).values({ title: "Send the quote", arena: "collective", due: "2026-11-01", status: "open" });

    const result = await writeDailyBrief(db, scope, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.source).toBe("offline");
    expect(result.data.body).toContain("Overdue (1)");

    const [row] = await db.select().from(digests).where(eq(digests.kind, "daily_brief"));
    expect(row).toMatchObject({ day: TODAY, source: "offline", createdBy: "automation" });
  });

  it("replaces the brief rather than writing a second one for the same day", async () => {
    await writeDailyBrief(db, scope, null);
    await db.insert(tasks).values({ title: "A new overdue thing", arena: "misc", due: "2026-11-01", status: "open" });
    await writeDailyBrief(db, scope, null);

    const rows = await db.select().from(digests).where(eq(digests.kind, "daily_brief"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toContain("A new overdue thing");
  });

  it("keeps what the model writes when it writes enough", async () => {
    const model: BriefModel = {
      async write() {
        return "A quiet Tuesday. One thing overdue, nothing on the calendar, and nothing waiting on your say-so.";
      },
    };
    const result = await writeDailyBrief(db, scope, model);
    expect(result.ok && result.data.source).toBe("model");
    expect(result.ok && result.data.body).toContain("quiet Tuesday");
  });

  it("falls back to the template when the model fails or says too little", async () => {
    const failing: BriefModel = {
      async write() {
        throw new Error("API unavailable");
      },
    };
    const terse: BriefModel = { async write() { return "ok"; } };

    for (const model of [failing, terse]) {
      const result = await writeDailyBrief(db, scope, model);
      expect(result.ok && result.data.source).toBe("offline");
    }
  });

  it("writes conflict times in local wall time, not as ISO instants", async () => {
    await db.insert(calendarEvents).values([
      {
        title: "Kinetic pilot call",
        arena: "collective",
        kind: "other",
        source: "manual",
        startsAt: zonedTimeToInstant(TODAY, "18:15", NY),
        endsAt: zonedTimeToInstant(TODAY, "19:15", NY),
      },
      {
        title: "Home game vs Dayton",
        arena: "basketball",
        kind: "game",
        source: "manual",
        startsAt: zonedTimeToInstant(TODAY, "18:30", NY),
        endsAt: zonedTimeToInstant(TODAY, "20:30", NY),
      },
    ]);

    const result = await writeDailyBrief(db, scope, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 18:15 local is 23:15Z. The brief is read by Devon, so it says 18:15.
    expect(result.data.body).toContain("18:15 · Kinetic pilot call clashes with Home game vs Dayton");
    expect(result.data.body).not.toMatch(/\dZ|T\d\d:/);
  });

  it("hands the model the already-worked-out brief, not the raw rows", async () => {
    await db.insert(tasks).values({ title: "Send the quote", arena: "collective", due: "2026-11-01", status: "open" });
    let seen = "";
    await writeDailyBrief(db, scope, {
      async write(input) {
        seen = input.brief;
        return "x".repeat(50);
      },
    });
    expect(seen).toContain("Overdue (1)");
    expect(seen).toContain("Send the quote");
  });
});
