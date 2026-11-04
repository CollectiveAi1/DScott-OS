import { createHash } from "node:crypto";
import { z } from "zod";
import { contactById } from "@/modules/crm/queries";
import { contactName } from "@/modules/crm/service";
import { createApproval } from "@/modules/approvals/service";
import { fail, ok, type Tool } from "../registry";

const ARENA = z.enum(["collective", "basketball", "family", "misc"]);

/**
 * Drafting an outbound message.
 *
 * This is the only tool that touches anything outbound, and it reaches exactly one function:
 * M8's `createApproval`. It cannot send, cannot schedule, and cannot choose the delivery mode —
 * those live behind a decision Devon makes by hand on `/approvals`.
 *
 * The idempotency key is a hash of what is being said to whom, so a retried tool call returns
 * the draft that already exists instead of writing a second one.
 */
export const messagesDraftTool: Tool<{
  kind: "email" | "text";
  body: string;
  contactId?: string | null;
  to?: string | null;
  subject?: string | null;
  arena?: "collective" | "basketball" | "family" | "misc";
}> = {
  name: "messages.draft",
  description:
    "Draft an email or a text. It is saved to the Approvals queue as waiting — it is NOT sent, " +
    "and nothing in this system can send it without Devon approving it by hand. Say that it is " +
    "waiting for approval; never say it was sent. Give a contactId to use that contact's email " +
    "or phone, or a literal recipient in `to`. Email drafts need a subject.",
  effect: "write",
  input: z.object({
    kind: z.enum(["email", "text"]),
    body: z.string().min(1).max(8000),
    contactId: z.string().uuid().nullish(),
    to: z.string().max(200).nullish(),
    subject: z.string().max(300).nullish(),
    arena: ARENA.optional(),
  }),
  async run(ctx, input) {
    let to = input.to?.trim() ?? "";
    let contactId: string | null = null;
    let who = to;

    if (input.contactId) {
      const contact = await contactById(ctx.db, input.contactId);
      if (!contact) return fail("not_found", "That contact is no longer there.");
      contactId = contact.id;
      who = contactName(contact);
      if (!to) to = (input.kind === "email" ? contact.email : contact.phone)?.trim() ?? "";
      if (!to) {
        return fail("no_recipient", `${who} has no ${input.kind === "email" ? "email address" : "phone number"} on file.`);
      }
    }

    if (!to) return fail("no_recipient", "A draft needs a recipient: a contactId or a `to`.");
    if (input.kind === "email" && !input.subject?.trim()) {
      return fail("no_subject", "An email draft needs a subject.");
    }

    const payload =
      input.kind === "email"
        ? { to, subject: input.subject?.trim() ?? "", body: input.body }
        : { to, body: input.body };

    const idempotencyKey = `operator:${createHash("sha256")
      .update(`${input.kind}|${to}|${input.subject ?? ""}|${input.body}`)
      .digest("hex")
      .slice(0, 32)}`;

    const result = await createApproval(ctx.db, {
      kind: input.kind,
      payload,
      contactId,
      arena: input.arena ?? "collective",
      idempotencyKey,
      createdBy: "operator",
    });
    if (!result.ok) return fail(result.error.code, result.error.message);

    return ok({
      approvalId: result.data.approval.id,
      status: result.data.approval.status,
      newDraft: result.data.created,
      to,
      contact: contactId ? who : null,
      sent: false,
      note: result.data.created
        ? "Saved to Approvals as waiting. Nothing has been sent; Devon has to approve it."
        : "An identical draft was already waiting in Approvals. Nothing has been sent.",
    });
  },
};

export const MESSAGE_TOOLS = [messagesDraftTool];
