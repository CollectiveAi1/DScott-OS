# SPEC-006 · M6 Contacts + Pipelines

**Milestone:** M6 (PRD §8.6) · **Depends on:** M2 · **Branch:** `m6-contacts-pipelines`
**Status:** SHIPPED 2026-11-03

The people and the money. Contacts is the record of who Devon knows; Pipelines is the record of
what is actually moving. Together they answer the problem statement's sharpest line: *"deals go
quiet because nothing tells me a next step is missing or overdue."*

This is also the last module before Approvals and the Operator, and it builds two things both of
those depend on: the **timeline** a contact accumulates, and the **do-not-contact** flag that
stops a draft from ever being written.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | `/contacts`: search, filter by type, create, edit | §8.6 |
| 2 | Contact page: details, org, deals, open tasks, merged timeline | §8.6 |
| 3 | Add note, log call, log meeting | §8.6 |
| 4 | `do_not_contact`, enforced in the service | §8.6 |
| 5 | `/pipelines`: a board per pipeline, cards with next-step discipline | §8.6 |
| 6 | Deals: create, edit, move stage; money typed as `$1,250` | §8.6 |
| 7 | A stage move writes a `timeline` row | §8.6 |
| 8 | Handoff tasks for billing and onboarding, exactly once | §8.6 |
| 9 | Settings → Pipelines: stage names and billing stages | §8.6 |
| 10 | `pipelines.billing_stages`, and the seed that fills it | §8.6, §6.2 |

### Out of scope

- Sending anything. A handoff is a task **inside** the OS; nothing notifies Ahmad or Kenza.
  Messages are M8's problem and go through Approvals.
- Importing contacts. The PRD's §12 default is "start clean; no Airtable import".
- Org management as its own screen. An org is created inline from a contact and edited there;
  a dedicated screen would be furniture nobody asked for.

---

## 2. Contacts

### The list

Search covers first name, last name, email, phone, tags and the org's name — one box, because
Devon will not remember which field he knows someone by. Filter by type is multi-select. State
lives in the URL, as everywhere since M2.

**Types**: Client, Prospect, Partner, Investor, Team, Athlete, Parent, Vendor.

### The contact page

Details, the linked org, their deals, their open tasks, and a **timeline**.

The timeline is three sources merged, newest first:

| Source | Shows as |
| --- | --- |
| `timeline` rows | the note, call, meeting or stage move itself |
| completed tasks linked to the contact | "Done: <title>" |
| approvals linked to the contact | what was drafted, and what happened to it |

Cursor-paginated on `(createdAt, id)`. Each source is queried for the page's worth of rows older
than the cursor, merged, sorted and sliced — so one chatty source cannot crowd the others out of
the page, and the cursor stays stable as new rows land.

### Do not contact

A flag on the contact, and a **service-level** guard: `assertContactable()` refuses, with a
reason, for any contact carrying it. M8 calls it before an approval is ever drafted, and M9's
Operator calls it through M8.

Enforcing it in the UI alone would be theatre — the Operator does not use the UI. It ships as a
tested function now, with the one screen that exists today (the contact page) showing the flag
plainly, so the guarantee is in place before anything can draft.

---

## 3. Pipelines

One board per pipeline, cards in stage columns. A card shows title, contact, value, and the next
step with its due date.

**Next-step discipline.** A deal with no next step, or one whose next step is past due, gets a
red edge and says which — **"No next step"** or **"Overdue"**. This is the whole point of the
screen: PRD §11 wants every open deal carrying a dated next step each Monday, and a board that
looks calm while deals rot would be worse than no board.

Moving a deal writes a `timeline` row — `stage_move`, body `"Quote sent → Deposit"` — against
both the deal and its contact, so the move shows up in that person's history, and so Command's
"Deals moved · 7 days" tile counts something real.

### Money

Typed the way it is said: `$1,250`, `1,250.50`, `1250` all become cents. Stored as an integer,
formatted only at render (§6.1). Anything unreadable is refused with a message, never rounded
into something plausible.

---

## 4. Handoffs

Automation, `createdBy = automation`. Both are tasks in the OS; neither notifies anyone.

| Trigger | Task |
| --- | --- |
| A deal enters a stage in its pipeline's `billingStages` | "Invoice: <title> ($1,250.00)", owner **Ahmad**, arena collective, due today + 2 business days, linked to the deal |
| A contact gains the type Client | "Onboard: <name>", owner **Kenza**, due today + 2 business days |

**Exactly once, by construction.** Each handoff carries a `handoff_key` on the task, unique:
`invoice:<dealId>:<stage>` and `onboard:<contactId>`. The insert is `on conflict do nothing`, so
"only once per deal per stage" is a database guarantee rather than a convention — moving a deal
out of Deposit and back cannot produce a second invoice task, and neither can two clicks landing
together.

The guarantee is **no duplicates while the handoff task exists**: repeated moves, out-and-back
moves and two simultaneous clicks all produce one task. Deleting the task deletes the key with
it, so a later move into that stage can create a fresh one — which is the helpful behaviour, not
a leak. Devon deleting an invoice task is a decision about that task, not a standing instruction
never to be reminded again, and a ledger of fired-and-deleted handoffs would be machinery
serving nobody.

**Business days** skip Saturday and Sunday. Holidays are not modelled: Devon's team is four
people, and a wrong-by-one-day internal due date is not worth a calendar of federal holidays.

---

## 5. Settings → Pipelines

Stage names and billing stages, per pipeline, because the seed's stages are drafts (PRD §12) and
Devon will rename them within a week.

- Stages are edited as an ordered list. Renaming a stage **moves the deals standing in it**, so a
  rename cannot silently orphan a board column.
- Removing a stage is refused while any deal still stands in it, naming how many. Losing a deal
  to a dropdown edit is not an acceptable failure mode.
- Billing stages are ticked from that pipeline's own stages.

---

## 6. Schema

| Change | Detail |
| --- | --- |
| `pipelines.billing_stages text[] default '{}'` | PRD §6.2 |
| `tasks.handoff_key text`, unique | **Beyond §6.2's list.** What makes "exactly once" a guarantee rather than a hope |
| `timeline.created_at` index | The merged timeline reads `(contact_id, created_at desc)` |

Seed: Kinetic Scholar `[Pilot signed, Paid]`, Client builds `[Deposit]`, Civic Sports
`[Enrolled]`, Investors `[]`.

---

## 7. Acceptance criteria

1. **Moving a Client-builds deal to Deposit creates exactly one Ahmad task**, and moving it out
   and back does not create a second. ✔ test
2. **A contact gaining type Client creates one Kenza task**, once, however many times it is
   saved. ✔ test
3. **Command's "Deals moved · 7 days" counts real stage moves.** ✔ test
4. **`$1,250` stores 125000**, as do `1,250.00` and `1250`; `abc` is refused. ✔ test
5. **A deal with no next step, or a past-due one, is marked** as such. ✔ test
6. **A stage move writes a timeline row** reading "Quote sent → Deposit", visible on the deal and
   on the contact. ✔ test
7. **The merged timeline** interleaves notes, completed tasks and approvals in time order, and
   pages with a cursor without repeating or skipping a row. ✔ test
8. **`assertContactable` refuses a do-not-contact contact**, and allows everyone else. ✔ test
9. **Search finds a contact by name, email, phone, tag or org.** ✔ test
10. **Renaming a stage moves the deals in it**; removing a stage with deals in it is refused. ✔ test
11. **Due dates skip the weekend.** ✔ test
12. **`npm run check` is green.**

---

## 8. Accepted trade-offs

- **A unique column for handoff identity.** The alternative — inferring "has this already
  happened" from task titles or timeline history — is a guess that breaks the first time a deal
  is renamed. One indexed column makes it provable.
- **Merging the timeline in the application, not in SQL.** A `UNION ALL` across three tables with
  a compound cursor is harder to read and no faster at this size. Each source is indexed and
  bounded by the page size.
- **No holiday calendar.** Two business days skipping weekends is close enough for a task Ahmad
  sees in the OS.
- **Orgs are edited inline.** One field on the contact that creates an org if the name is new.

---

## 9. Changed during BUILD

### `src/lib/form-fields.ts` — the same bug, a third time

A browser posts **no key at all** for a control it did not render or a box nobody ticked. Three
milestones have now been bitten by schemas that only tolerate an empty string: M3's all-day
checkbox, M3's hidden time inputs, and M6's log form, which put "Check the form." in front of
Devon for a `dealId` that was never on screen.

Each module had its own near-identical `optionalText` / `optionalDate` / `optionalId`. They are
now one tested file — `optionalText`, `optionalDate`, `optionalTime`, `optionalId`, `checkbox`
and `issueToMessage` — used by Work, Schedule and CRM alike. Absent and empty mean the same
thing, because to the person filling in the form they are the same thing.

### The seed backfills billing stages

`billingStages` was added in this milestone, so every pipeline seeded by an earlier one carried
an empty array — which silently means "no billing handoff will ever fire". The seed is
`onConflictDoNothing`, so re-running it would never have fixed them. It now backfills the
starter values **only where nothing has been configured**, so an existing install gets working
billing stages and Devon's own edits in Settings are never overwritten.

This is a general hazard of an idempotent seed: adding a column's values to the starter data
does not reach rows that already exist. Worth checking at every milestone that adds one.

### A rename carries the billing flag

Renaming a billing stage turned billing off. The Settings form posts whatever was ticked *before*
the edit, so the old name no longer matched a stage and was filtered away. The rename map now
applies to `billingStages` as well as to the deals standing in the stage — the same silent-loss
failure, one level up.

### Handoffs are exactly-once while the task exists

The spec first claimed a deleted handoff would never return. It cannot: deleting the task
deletes its key. §4 now states the guarantee that actually holds, and it is the more useful one.
