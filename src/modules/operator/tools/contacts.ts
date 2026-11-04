import { z } from "zod";
import { contactName } from "@/modules/crm/service";
import { logTimelineEntry } from "@/modules/crm/service";
import { contactById, contactTimeline, searchContacts } from "@/modules/crm/queries";
import { fail, ok, type Tool } from "../registry";

export const contactsSearchTool: Tool<{ query?: string; types?: string[]; limit?: number }> = {
  name: "contacts.search",
  description:
    "Find contacts by name, organisation, email, phone or tag, optionally narrowed to types " +
    "(Client, Prospect, Partner, Investor, Team, Athlete, Parent, Vendor). Returns whether each " +
    "one is marked do-not-contact.",
  effect: "read",
  input: z.object({
    query: z.string().max(200).optional(),
    types: z.array(z.string().max(40)).max(8).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async run(ctx, input) {
    const rows = await searchContacts(ctx.db, {
      query: input.query ?? "",
      types: input.types ?? [],
      limit: input.limit ?? 20,
    });
    return ok({
      count: rows.length,
      contacts: rows.map((row) => ({
        id: row.id,
        name: contactName(row),
        org: row.orgName,
        email: row.email,
        phone: row.phone,
        types: row.types,
        doNotContact: row.doNotContact,
      })),
    });
  },
};

export const contactsTimelineTool: Tool<{ id: string; limit?: number }> = {
  name: "contacts.timeline",
  description:
    "The history for one contact, newest first: notes, calls, meetings, stage moves, completed " +
    "tasks and approvals.",
  effect: "read",
  input: z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(50).optional() }),
  async run(ctx, input) {
    const contact = await contactById(ctx.db, input.id);
    if (!contact) return fail("not_found", "That contact is no longer there.");

    const page = await contactTimeline(ctx.db, input.id, { limit: input.limit ?? 20 });
    return ok({
      contact: { id: contact.id, name: contactName(contact), doNotContact: contact.doNotContact },
      entries: page.items.map((item) => ({
        kind: item.kind,
        body: item.body,
        detail: item.detail ?? null,
        at: item.at.toISOString(),
      })),
    });
  },
};

export const contactsAddNoteTool: Tool<{ id: string; body: string; kind?: "note" | "call" | "meeting" }> = {
  name: "contacts.add_note",
  description:
    "Add a note, a logged call or a logged meeting to a contact's timeline. This records " +
    "something that happened; it does not contact anyone.",
  effect: "write",
  input: z.object({
    id: z.string().uuid(),
    body: z.string().min(1).max(4000),
    kind: z.enum(["note", "call", "meeting"]).optional(),
  }),
  async run(ctx, input) {
    const contact = await contactById(ctx.db, input.id);
    if (!contact) return fail("not_found", "That contact is no longer there.");

    const result = await logTimelineEntry(ctx.db, {
      kind: input.kind ?? "note",
      body: input.body,
      contactId: input.id,
      dealId: null,
    });
    if (!result.ok) return fail(result.error.code, result.error.message);
    return ok({ id: result.data.id, kind: result.data.kind, contact: contactName(contact) });
  },
};

export const CONTACT_TOOLS = [contactsSearchTool, contactsTimelineTool, contactsAddNoteTool];
