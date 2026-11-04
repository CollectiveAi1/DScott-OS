import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import {
  approvals,
  boards,
  calendarEvents,
  contacts,
  deals,
  pipelines,
  practiceLog,
  skills,
  tasks,
  timeline,
  type ProtectedBlock,
} from "../src/db/schema";
import { startOfDayInstant, zonedTimeToInstant } from "../src/lib/zoned";
import type { ToolContext } from "../src/modules/operator/registry";
import { TOOLS } from "../src/modules/operator/tools";
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
  await db.delete(timeline);
  await db.delete(approvals);
  await db.delete(practiceLog);
  await db.delete(skills);
  await db.delete(deals);
  await db.delete(pipelines);
  await db.delete(contacts);
  await db.delete(calendarEvents);
  await db.delete(tasks);
  await db.delete(boards);
});

function ctx(protectedTime: ProtectedBlock[] = []): ToolContext {
  return { db, timeZone: NY, today: TODAY, now: NOW, protectedTime };
}

/** Run a tool the way the loop does: validate the input, then call it. */
async function call(name: string, input: unknown, protectedTime: ProtectedBlock[] = []) {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`no tool called ${name}`);
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) throw new Error(`bad input for ${name}: ${parsed.error.issues[0]?.message}`);
  return tool.run(ctx(protectedTime), parsed.data);
}

function data<T>(outcome: Awaited<ReturnType<typeof call>>): T {
  if (!outcome.ok) throw new Error(`expected ok, got: ${outcome.error.message}`);
  return outcome.data as T;
}

describe("capture", () => {
  it("writes an untriaged task and strips the tokens", async () => {
    const result = data<{ title: string; arena: string; priority: string; due: string; untriaged: boolean }>(
      await call("capture", { line: "Call coach re: film session #basketball !high due:tomorrow" }),
    );
    expect(result).toMatchObject({
      title: "Call coach re: film session",
      arena: "basketball",
      priority: "high",
      due: "2026-11-11",
      untriaged: true,
    });
  });

  it("records the Operator as the author", async () => {
    await call("capture", { line: "Something" });
    const [row] = await db.select().from(tasks).limit(1);
    expect(row?.createdBy).toBe("operator");
  });
});

describe("tasks.search", () => {
  beforeEach(async () => {
    await db.insert(tasks).values([
      { title: "Overdue thing", arena: "collective", due: "2026-11-01", status: "open" },
      { title: "Today thing", arena: "basketball", due: TODAY, status: "open" },
      { title: "Later thing", arena: "collective", due: "2026-11-30", status: "open" },
      { title: "Undated thing", arena: "misc", status: "open" },
      { title: "Finished thing", arena: "collective", due: "2026-11-02", status: "done" },
    ]);
  });

  it("filters by due window", async () => {
    const overdue = data<{ tasks: { title: string }[] }>(await call("tasks.search", { due: "overdue" }));
    expect(overdue.tasks.map((task) => task.title)).toEqual(["Overdue thing"]);

    const today = data<{ tasks: { title: string }[] }>(await call("tasks.search", { due: "today" }));
    expect(today.tasks.map((task) => task.title)).toEqual(["Today thing"]);

    const undated = data<{ tasks: { title: string }[] }>(await call("tasks.search", { due: "none" }));
    expect(undated.tasks.map((task) => task.title)).toEqual(["Undated thing"]);
  });

  it("looks at open tasks unless asked otherwise", async () => {
    const open = data<{ count: number }>(await call("tasks.search", {}));
    expect(open.count).toBe(4);
    const done = data<{ tasks: { title: string }[] }>(await call("tasks.search", { status: "done" }));
    expect(done.tasks.map((task) => task.title)).toEqual(["Finished thing"]);
  });

  it("filters by arena and by text", async () => {
    expect(data<{ count: number }>(await call("tasks.search", { arena: "basketball" })).count).toBe(1);
    expect(data<{ count: number }>(await call("tasks.search", { text: "THING" })).count).toBe(4);
    expect(data<{ count: number }>(await call("tasks.search", { text: "nothing like this" })).count).toBe(0);
  });
});

describe("tasks.create", () => {
  it("files a task onto a board column", async () => {
    const [board] = await db
      .insert(boards)
      .values({ name: "This week", columns: ["Now", "Next", "Done"], position: 0 })
      .returning();

    const result = data<{ title: string; arena: string; untriaged: boolean }>(
      await call("tasks.create", { title: "Draft the pilot quote", arena: "collective", board: "this week", column: "Now", due: "2026-11-12" }),
    );
    expect(result).toMatchObject({ title: "Draft the pilot quote", arena: "collective", untriaged: false });

    const [row] = await db.select().from(tasks).limit(1);
    expect(row).toMatchObject({ boardId: board?.id, boardColumn: "Now", due: "2026-11-12" });
  });

  it("names the boards that exist when asked for one that does not", async () => {
    await db.insert(boards).values({ name: "This week", columns: ["Now"], position: 0 });
    const outcome = await call("tasks.create", { title: "x", arena: "misc", board: "Nowhere" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).toContain("This week");
  });

  it("refuses a column that is not on the board, and writes nothing at all", async () => {
    await db.insert(boards).values({ name: "This week", columns: ["Now"], position: 0 });
    const outcome = await call("tasks.create", { title: "x", arena: "misc", board: "This week", column: "Someday" });
    expect(outcome.ok).toBe(false);
    // The board is checked before anything is written, so a bad column leaves no stray capture.
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("works with no board at all", async () => {
    const result = data<{ untriaged: boolean }>(await call("tasks.create", { title: "Unfiled", arena: "misc" }));
    expect(result.untriaged).toBe(false);
  });
});

describe("tasks.complete", () => {
  it("completes an open task and refuses a second time", async () => {
    const [task] = await db.insert(tasks).values({ title: "Do it", arena: "misc", status: "open" }).returning();
    const first = await call("tasks.complete", { id: task!.id });
    expect(first.ok).toBe(true);

    const second = await call("tasks.complete", { id: task!.id });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toContain("already done");
  });
});

describe("schedule.range", () => {
  it("lists events with local wall times and says which are read-only", async () => {
    await db.insert(calendarEvents).values([
      {
        title: "Kinetic Edge standup",
        arena: "collective",
        kind: "other",
        source: "manual",
        startsAt: zonedTimeToInstant(TODAY, "09:00", NY),
        endsAt: zonedTimeToInstant(TODAY, "09:30", NY),
      },
      {
        title: "Family dinner",
        arena: "family",
        kind: "family",
        source: "google",
        startsAt: zonedTimeToInstant(TODAY, "18:00", NY),
        endsAt: zonedTimeToInstant(TODAY, "19:00", NY),
      },
    ]);

    const result = data<{ events: { title: string; start: string; readOnly: boolean }[] }>(
      await call("schedule.range", { from: TODAY, to: TODAY }),
    );
    expect(result.events).toMatchObject([
      { title: "Kinetic Edge standup", start: "09:00", readOnly: false },
      { title: "Family dinner", start: "18:00", readOnly: true },
    ]);
  });

  it("refuses a range longer than 60 days", async () => {
    const outcome = await call("schedule.range", { from: "2026-01-01", to: "2026-12-31" });
    expect(outcome.ok).toBe(false);
  });
});

describe("schedule.free_slots", () => {
  it("never offers time taken by an event or by protected time", async () => {
    await db.insert(calendarEvents).values({
      title: "Practice",
      arena: "basketball",
      kind: "practice",
      source: "manual",
      startsAt: zonedTimeToInstant(TODAY, "16:00", NY),
      endsAt: zonedTimeToInstant(TODAY, "18:00", NY),
    });
    const block: ProtectedBlock = { label: "Deep work", days: [2], start: "09:00", end: "11:00" };

    const result = data<{ slots: { start: string; end: string }[] }>(
      await call("schedule.free_slots", { from: TODAY, days: 1, minutes: 30 }, [block]),
    );
    // Today is a Tuesday. 07:00 is "now", the window opens at 08:00.
    expect(result.slots).toEqual([
      { date: TODAY, start: "08:00", end: "09:00", minutes: 60 },
      { date: TODAY, start: "11:00", end: "16:00", minutes: 300 },
      { date: TODAY, start: "18:00", end: "20:00", minutes: 120 },
    ]);
  });

  it("gives nothing back on a day an all-day event covers", async () => {
    await db.insert(calendarEvents).values({
      title: "Away trip",
      arena: "basketball",
      kind: "travel",
      source: "manual",
      allDay: true,
      startsAt: startOfDayInstant(TODAY, NY),
      endsAt: startOfDayInstant("2026-11-11", NY),
    });
    const result = data<{ count: number }>(await call("schedule.free_slots", { from: TODAY, days: 1 }));
    expect(result.count).toBe(0);
  });
});

describe("schedule.conflicts", () => {
  it("reports a pair that overlaps across arenas", async () => {
    await db.insert(calendarEvents).values([
      {
        title: "Investor call",
        arena: "collective",
        kind: "other",
        source: "manual",
        startsAt: zonedTimeToInstant("2026-11-12", "18:00", NY),
        endsAt: zonedTimeToInstant("2026-11-12", "19:00", NY),
      },
      {
        title: "Game vs Dayton",
        arena: "basketball",
        kind: "game",
        source: "manual",
        startsAt: zonedTimeToInstant("2026-11-12", "18:30", NY),
        endsAt: zonedTimeToInstant("2026-11-12", "20:30", NY),
      },
    ]);

    const result = data<{ conflicts: { kind: string; a: { title: string }; b: { title: string } }[] }>(
      await call("schedule.conflicts", { from: TODAY, days: 7 }),
    );
    expect(result.conflicts).toHaveLength(1);
    expect([result.conflicts[0]?.a.title, result.conflicts[0]?.b.title].sort()).toEqual(["Game vs Dayton", "Investor call"]);
  });
});

describe("schedule.create_event", () => {
  it("creates a timed basketball event and records the Operator", async () => {
    const result = data<{ event: { title: string; date: string; start: string; end: string } }>(
      await call("schedule.create_event", {
        title: "Film review",
        arena: "basketball",
        kind: "team_event",
        date: "2026-11-12",
        start: "19:00",
        end: "20:00",
      }),
    );
    expect(result.event).toMatchObject({ title: "Film review", date: "2026-11-12", start: "19:00", end: "20:00" });

    const [row] = await db.select().from(calendarEvents).limit(1);
    expect(row).toMatchObject({ createdBy: "operator", source: "manual" });
  });

  it("refuses a kind that does not belong to the arena, and names the ones that do", async () => {
    const outcome = await call("schedule.create_event", {
      title: "x",
      arena: "collective",
      kind: "practice",
      date: "2026-11-12",
      start: "09:00",
      end: "10:00",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain("deadline");
  });

  it("refuses a timed event with no end", async () => {
    const outcome = await call("schedule.create_event", {
      title: "x",
      arena: "misc",
      kind: "other",
      date: "2026-11-12",
      start: "09:00",
      allDay: false,
    });
    expect(outcome.ok).toBe(false);
  });

  it("says when the new event lands inside protected time", async () => {
    const block: ProtectedBlock = { label: "Family dinner", days: [4], start: "18:00", end: "20:00" };
    const result = data<{ protectedTimeHit: string[] }>(
      await call(
        "schedule.create_event",
        { title: "Film review", arena: "basketball", kind: "team_event", date: "2026-11-12", start: "19:00", end: "20:00" },
        [block],
      ),
    );
    expect(result.protectedTimeHit).toEqual(["Family dinner"]);
  });
});

describe("contacts", () => {
  async function aContact(overrides: Partial<typeof contacts.$inferInsert> = {}) {
    const [row] = await db
      .insert(contacts)
      .values({ firstName: "Rosa", lastName: "Mendez", email: "rosa@brightstart.example", types: ["Client"], ...overrides })
      .returning();
    return row!;
  }

  it("searches and reports the do-not-contact flag", async () => {
    await aContact({ firstName: "Rosa", doNotContact: true });
    const result = data<{ contacts: { name: string; doNotContact: boolean }[] }>(
      await call("contacts.search", { query: "rosa" }),
    );
    expect(result.contacts).toMatchObject([{ name: "Rosa Mendez", doNotContact: true }]);
  });

  it("adds a note to the timeline", async () => {
    const contact = await aContact();
    const result = data<{ kind: string; contact: string }>(
      await call("contacts.add_note", { id: contact.id, body: "Left a voicemail.", kind: "call" }),
    );
    expect(result).toMatchObject({ kind: "call", contact: "Rosa Mendez" });

    const rows = await db.select().from(timeline).where(eq(timeline.contactId, contact.id));
    expect(rows).toHaveLength(1);
  });

  it("reads a timeline back, newest first", async () => {
    const contact = await aContact();
    await call("contacts.add_note", { id: contact.id, body: "First" });
    await call("contacts.add_note", { id: contact.id, body: "Second" });

    const result = data<{ entries: { body: string }[] }>(await call("contacts.timeline", { id: contact.id }));
    expect(result.entries.map((entry) => entry.body)).toContain("Second");
  });

  it("says plainly when a contact is gone", async () => {
    const outcome = await call("contacts.timeline", { id: "11111111-1111-4111-8111-111111111111" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toBe("That contact is no longer there.");
  });
});

describe("deals", () => {
  async function aPipeline(stages: string[], billingStages: string[] = []) {
    const [row] = await db.insert(pipelines).values({ name: "Client builds", stages, billingStages }).returning();
    return row!;
  }

  it("summarises each stage with its count and value", async () => {
    const pipeline = await aPipeline(["Deposit", "Build"]);
    await db.insert(deals).values([
      { title: "Build A", pipelineId: pipeline.id, stage: "Deposit", valueCents: 125000 },
      { title: "Build B", pipelineId: pipeline.id, stage: "Deposit", valueCents: 75000 },
    ]);

    const result = data<{ pipelines: { name: string; stages: { stage: string; deals: number; value: string }[] }[] }>(
      await call("deals.pipeline_summary", {}),
    );
    expect(result.pipelines[0]?.stages[0]).toEqual({ stage: "Deposit", deals: 2, value: "$2,000.00" });
  });

  it("finds deals with no next step and with an overdue one", async () => {
    const pipeline = await aPipeline(["Deposit"]);
    await db.insert(deals).values([
      { title: "No step", pipelineId: pipeline.id, stage: "Deposit" },
      { title: "Late step", pipelineId: pipeline.id, stage: "Deposit", nextStep: "Chase", nextStepDue: "2026-11-01" },
      { title: "Fine", pipelineId: pipeline.id, stage: "Deposit", nextStep: "Chase", nextStepDue: "2026-12-01" },
    ]);

    const result = data<{ noNextStep: { title: string }[]; overdue: { title: string }[] }>(await call("deals.stale", {}));
    expect(result.noNextStep.map((deal) => deal.title)).toEqual(["No step"]);
    expect(result.overdue.map((deal) => deal.title)).toEqual(["Late step"]);
  });

  it("moves a stage, writes the timeline row, and fires the billing handoff once", async () => {
    const pipeline = await aPipeline(["Quote sent", "Deposit"], ["Deposit"]);
    const [deal] = await db.insert(deals).values({ title: "Build A", pipelineId: pipeline.id, stage: "Quote sent" }).returning();

    const first = await call("deals.move_stage", { id: deal!.id, stage: "Deposit" });
    expect(first.ok).toBe(true);

    const moves = await db.select().from(timeline).where(eq(timeline.kind, "stage_move"));
    expect(moves).toHaveLength(1);

    const handoffs = await db.select().from(tasks).where(eq(tasks.createdBy, "automation"));
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.owner).toBe("Ahmad");

    // Back and forth does not invoice twice: M6's handoff key holds through the Operator too.
    await call("deals.move_stage", { id: deal!.id, stage: "Quote sent" });
    await call("deals.move_stage", { id: deal!.id, stage: "Deposit" });
    expect(await db.select().from(tasks).where(eq(tasks.createdBy, "automation"))).toHaveLength(1);
  });

  it("refuses a stage the pipeline does not have", async () => {
    const pipeline = await aPipeline(["Deposit"]);
    const [deal] = await db.insert(deals).values({ title: "Build A", pipelineId: pipeline.id, stage: "Deposit" }).returning();
    const outcome = await call("deals.move_stage", { id: deal!.id, stage: "Invented" });
    expect(outcome.ok).toBe(false);
  });
});

describe("learning", () => {
  it("logs practice against a skill matched by name", async () => {
    await db.insert(skills).values({ name: "TypeScript", currentLevel: 2, targetLevel: 4 });
    const result = data<{ skill: string; minutes: number; day: string }>(
      await call("learning.log_practice", { skill: "typescript", minutes: 45 }),
    );
    expect(result).toEqual({ skill: "TypeScript", minutes: 45, day: TODAY });
  });

  it("names the skills that exist when asked for one that does not", async () => {
    await db.insert(skills).values({ name: "TypeScript", currentLevel: 1, targetLevel: 3 });
    const outcome = await call("learning.log_practice", { skill: "Welding", minutes: 30 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain("TypeScript");
  });

  it("summarises skills with their logged minutes", async () => {
    const [skill] = await db.insert(skills).values({ name: "TypeScript", currentLevel: 1, targetLevel: 3 }).returning();
    await db.insert(practiceLog).values({ skillId: skill!.id, day: TODAY, minutes: 30 });

    const result = data<{ skills: { name: string; minutes7d: number }[] }>(await call("learning.summary", {}));
    expect(result.skills).toMatchObject([{ name: "TypeScript", minutes7d: 30 }]);
  });
});

describe("messages.draft", () => {
  async function aContact(overrides: Partial<typeof contacts.$inferInsert> = {}) {
    const [row] = await db
      .insert(contacts)
      .values({ firstName: "Kenza", email: "kenza@example.com", phone: "+1 555 0100", types: ["Team"], ...overrides })
      .returning();
    return row!;
  }

  it("creates a waiting approval and says nothing was sent", async () => {
    const contact = await aContact();
    const result = data<{ status: string; sent: boolean; note: string; to: string }>(
      await call("messages.draft", { kind: "text", contactId: contact.id, body: "Onboarding for Brightstart is ready." }),
    );
    expect(result).toMatchObject({ status: "waiting", sent: false, to: "+1 555 0100" });
    expect(result.note).toContain("Nothing has been sent");

    const rows = await db.select().from(approvals);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "waiting", createdBy: "operator", kind: "text" });
  });

  it("refuses a contact marked do-not-contact", async () => {
    const contact = await aContact({ doNotContact: true });
    const outcome = await call("messages.draft", { kind: "email", contactId: contact.id, subject: "Hi", body: "Hello" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain("do-not-contact");
    expect(await db.select().from(approvals)).toHaveLength(0);
  });

  it("returns the existing draft when the same message is drafted twice", async () => {
    const contact = await aContact();
    const first = data<{ approvalId: string; newDraft: boolean }>(
      await call("messages.draft", { kind: "email", contactId: contact.id, subject: "Quote", body: "Attached." }),
    );
    const second = data<{ approvalId: string; newDraft: boolean; note: string }>(
      await call("messages.draft", { kind: "email", contactId: contact.id, subject: "Quote", body: "Attached." }),
    );

    expect(second.approvalId).toBe(first.approvalId);
    expect(first.newDraft).toBe(true);
    expect(second.newDraft).toBe(false);
    expect(second.note).toContain("already waiting");
    expect(await db.select().from(approvals)).toHaveLength(1);
  });

  it("refuses an email with no subject", async () => {
    const contact = await aContact();
    const outcome = await call("messages.draft", { kind: "email", contactId: contact.id, body: "Hello" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain("subject");
  });

  it("says when the contact has no address of that kind", async () => {
    const contact = await aContact({ email: null });
    const outcome = await call("messages.draft", { kind: "email", contactId: contact.id, subject: "Hi", body: "Hello" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.message).toContain("no email address");
  });

  it("needs a recipient of some kind", async () => {
    const outcome = await call("messages.draft", { kind: "text", body: "Hello" });
    expect(outcome.ok).toBe(false);
  });
});

describe("brief.today", () => {
  it("returns the computed day and the same text the stored brief would have", async () => {
    await db.insert(calendarEvents).values({
      title: "Kinetic Edge standup",
      arena: "collective",
      kind: "other",
      source: "manual",
      startsAt: zonedTimeToInstant(TODAY, "09:00", NY),
      endsAt: zonedTimeToInstant(TODAY, "09:30", NY),
    });
    await db.insert(tasks).values({ title: "Send the quote", arena: "collective", due: "2026-11-01", status: "open" });

    const result = data<{ day: string; text: string; data: { overdue: unknown[] } }>(await call("brief.today", {}));
    expect(result.day).toBe(TODAY);
    expect(result.text).toContain("Kinetic Edge standup");
    expect(result.text).toContain("Overdue (1)");
    expect(result.data.overdue).toHaveLength(1);
  });
});
