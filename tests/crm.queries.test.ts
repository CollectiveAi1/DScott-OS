import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { approvals, contacts, deals, orgs, pipelines, tasks, timeline } from "../src/db/schema";
import { contactTimeline, loadBoards, searchContacts, type TimelineCursor } from "../src/modules/crm/queries";
import { assertContactable, createContact, type ContactInput } from "../src/modules/crm/service";
import { freshDb } from "./helpers/db";

const TODAY = "2026-11-05";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.delete(approvals);
  await db.delete(timeline);
  await db.delete(tasks);
  await db.delete(deals);
  await db.delete(contacts);
  await db.delete(orgs);
  await db.delete(pipelines);
});

function contactInput(overrides: Partial<ContactInput> = {}): ContactInput {
  return {
    firstName: "Rosa",
    lastName: "Delgado",
    orgName: "Bright Start Daycare",
    email: "rosa@brightstart.example",
    phone: "(614) 555-0142",
    types: ["Prospect"],
    tags: ["columbus"],
    doNotContact: false,
    ...overrides,
  };
}

async function makeContact(overrides: Partial<ContactInput> = {}) {
  const result = await createContact(db, contactInput(overrides), TODAY);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("searchContacts", () => {
  beforeEach(async () => {
    await makeContact();
    await makeContact({
      firstName: "Marcus",
      lastName: "Webb",
      orgName: "Toledo Athletics",
      email: "marcus@toledo.example",
      phone: "419-555-0199",
      types: ["Client", "Partner"],
      tags: ["ohio", "referral"],
    });
  });

  const found = async (query = "", types: string[] = []) =>
    (await searchContacts(db, { query, types })).map((row) => row.firstName);

  it("returns everyone with no query", async () => {
    expect((await found()).sort()).toEqual(["Marcus", "Rosa"]);
  });

  it("finds by first name, last name and either case", async () => {
    expect(await found("rosa")).toEqual(["Rosa"]);
    expect(await found("WEBB")).toEqual(["Marcus"]);
  });

  it("finds by email", async () => {
    expect(await found("brightstart")).toEqual(["Rosa"]);
  });

  it("finds by phone, however it was punctuated", async () => {
    expect(await found("6145550142")).toEqual(["Rosa"]);
    expect(await found("555-0199")).toEqual(["Marcus"]);
  });

  it("finds by organisation", async () => {
    expect(await found("Toledo")).toEqual(["Marcus"]);
  });

  it("finds by tag", async () => {
    expect(await found("referral")).toEqual(["Marcus"]);
  });

  it("returns nothing for a query that matches nobody", async () => {
    expect(await found("zzz-nobody")).toEqual([]);
  });

  it("filters by type, matching any of them", async () => {
    expect(await found("", ["Client"])).toEqual(["Marcus"]);
    expect((await found("", ["Client", "Prospect"])).sort()).toEqual(["Marcus", "Rosa"]);
    expect(await found("", ["Investor"])).toEqual([]);
  });

  it("combines a query with a type filter", async () => {
    expect(await found("marcus", ["Client"])).toEqual(["Marcus"]);
    expect(await found("marcus", ["Investor"])).toEqual([]);
  });

  it("carries the organisation name through for the list", async () => {
    const [row] = await searchContacts(db, { query: "rosa", types: [] });
    expect(row?.orgName).toBe("Bright Start Daycare");
  });
});

describe("assertContactable", () => {
  it("allows an ordinary contact", async () => {
    const contact = await makeContact();
    expect(assertContactable(contact).ok).toBe(true);
  });

  it("refuses a do-not-contact contact, by name and with a reason", async () => {
    const contact = await makeContact({ firstName: "Quiet", lastName: "Neighbour", doNotContact: true });
    const result = assertContactable(contact);
    expect(result).toMatchObject({ ok: false, error: { code: "do_not_contact" } });
    if (!result.ok) expect(result.error.message).toContain("Quiet Neighbour");
  });
});

describe("contactTimeline", () => {
  /** Rows at known, distinct times so ordering is unambiguous. */
  async function seedHistory(contactId: string, count: number) {
    for (let index = 0; index < count; index++) {
      const at = new Date(Date.UTC(2026, 9, 1, 12, index));
      const [note] = await db
        .insert(timeline)
        .values({ kind: "note", body: `Note ${index}`, contactId })
        .returning();
      await db.update(timeline).set({ createdAt: at }).where(eq(timeline.id, note!.id));
    }
  }

  it("merges notes, finished tasks and approvals in time order", async () => {
    const contact = await makeContact();

    const [note] = await db.insert(timeline).values({ kind: "note", body: "Called about the quote", contactId: contact.id }).returning();
    await db.update(timeline).set({ createdAt: new Date("2026-10-01T10:00:00Z") }).where(eq(timeline.id, note!.id));

    const [task] = await db
      .insert(tasks)
      .values({ title: "Send the proposal", contactId: contact.id, status: "done", completedAt: new Date("2026-10-02T10:00:00Z") })
      .returning();
    expect(task).toBeTruthy();

    await db.insert(approvals).values({
      kind: "email",
      payload: { subject: "Following up" },
      status: "sent",
      idempotencyKey: "k1",
      contactId: contact.id,
      createdAt: new Date("2026-10-03T10:00:00Z"),
    });

    const page = await contactTimeline(db, contact.id);
    expect(page.items.map((item) => item.kind)).toEqual(["approval", "task_done", "note"]);
    expect(page.items[1]?.body).toBe("Done: Send the proposal");
    expect(page.items[2]?.body).toBe("Called about the quote");
  });

  it("shows only this contact's history", async () => {
    const mine = await makeContact();
    const theirs = await makeContact({ firstName: "Someone", lastName: "Else", email: null, phone: null });
    await db.insert(timeline).values({ kind: "note", body: "Mine", contactId: mine.id });
    await db.insert(timeline).values({ kind: "note", body: "Theirs", contactId: theirs.id });

    const page = await contactTimeline(db, mine.id);
    expect(page.items.map((item) => item.body)).toEqual(["Mine"]);
  });

  it("pages with a cursor without repeating or skipping anything", async () => {
    const contact = await makeContact();
    await seedHistory(contact.id, 25);

    const seen: string[] = [];
    let cursor: TimelineCursor | null = null;
    let pages = 0;

    do {
      const page: Awaited<ReturnType<typeof contactTimeline>> = await contactTimeline(db, contact.id, {
        limit: 10,
        cursor,
      });
      seen.push(...page.items.map((item) => item.body));
      cursor = page.next;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    // Newest first, all the way down.
    expect(seen[0]).toBe("Note 24");
    expect(seen.at(-1)).toBe("Note 0");
  });

  it("says there is no next page when the history fits on one", async () => {
    const contact = await makeContact();
    await seedHistory(contact.id, 3);
    const page = await contactTimeline(db, contact.id, { limit: 10 });
    expect(page.items).toHaveLength(3);
    expect(page.next).toBeNull();
  });

  it("is empty, not broken, for a contact with no history", async () => {
    const contact = await makeContact();
    expect(await contactTimeline(db, contact.id)).toEqual({ items: [], next: null });
  });

  it("does not let one chatty source crowd the others off a page", async () => {
    const contact = await makeContact();
    // Fifteen notes, all older than one finished task.
    await seedHistory(contact.id, 15);
    await db
      .insert(tasks)
      .values({ title: "Recent", contactId: contact.id, status: "done", completedAt: new Date("2026-11-01T10:00:00Z") });

    const page = await contactTimeline(db, contact.id, { limit: 5 });
    expect(page.items[0]?.kind).toBe("task_done");
    expect(page.items).toHaveLength(5);
  });
});

describe("loadBoards", () => {
  it("puts each deal in its stage, and strays in Unsorted first", async () => {
    const [pipeline] = await db
      .insert(pipelines)
      .values({ name: "Client builds", stages: ["Lead", "Quote sent", "Deposit"], billingStages: ["Deposit"] })
      .returning();
    const contact = await makeContact();

    await db.insert(deals).values([
      { title: "In Lead", pipelineId: pipeline!.id, stage: "Lead", contactId: contact.id },
      { title: "In Deposit", pipelineId: pipeline!.id, stage: "Deposit" },
      { title: "Orphaned", pipelineId: pipeline!.id, stage: "A stage that was renamed away" },
    ]);

    const [board] = await loadBoards(db);
    expect(board?.columns.map((column) => column.stage)).toEqual(["Unsorted", "Lead", "Quote sent", "Deposit"]);
    expect(board?.columns[0]?.deals.map((deal) => deal.title)).toEqual(["Orphaned"]);
    expect(board?.columns[1]?.deals[0]?.contactName).toBe("Rosa Delgado");
    expect(board?.columns[2]?.deals).toEqual([]);
  });

  it("has no Unsorted column when every deal is in a real stage", async () => {
    const [pipeline] = await db
      .insert(pipelines)
      .values({ name: "Investors", stages: ["Researched", "Committed"], billingStages: [] })
      .returning();
    await db.insert(deals).values({ title: "A fund", pipelineId: pipeline!.id, stage: "Researched" });

    const [board] = await loadBoards(db);
    expect(board?.columns.map((column) => column.stage)).toEqual(["Researched", "Committed"]);
  });
});
