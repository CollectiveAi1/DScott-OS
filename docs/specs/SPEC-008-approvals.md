# SPEC-008 · M8 Approvals engine

**Milestone:** M8 (PRD §8.8) · **Depends on:** M6 · **Branch:** `m8-approvals`
**Status:** SHIPPED 2026-11-04

This is the module the whole product rests on. PRD §1 calls it a differentiator — *"agents and
automations only draft"* — and §7's WON'T HAVE is blunter: **no automatic outbound send without
approval, ever, in this release.**

Everything else in the OS can be wrong in a way Devon notices and fixes. This one cannot. A bug
here reaches another person.

So the engine is built to make the dangerous thing structurally hard rather than merely
discouraged: there is one way to express an outbound action, one state machine that decides what
may happen next, and in v1 **no provider that can actually send anything**. Going live is
refused, by code, until one exists.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | The state machine, pure and exhaustively tested | §8.8 |
| 2 | `createApproval(...)` — the only way to express an outbound action | §8.8 |
| 3 | Payload schemas per kind, validated with zod | §8.8 |
| 4 | `do_not_contact` refused at creation | §8.8, §8.6 |
| 5 | Atomic claim-and-deliver, with a stuck-row sweep | §8.8 |
| 6 | `DeliveryProvider`, and the `NoopProvider` that is all v1 has | §8.8 |
| 7 | Going live blocked until a real provider is configured | §8.8 |
| 8 | `/approvals` with Waiting · Scheduled · Failed · History | §8.8 |
| 9 | The `approvals-deliver` job body, replacing M1's stub | §8.1 |
| 10 | `approval_status` gains `sending` | §8.8 |

### Out of scope

- Any provider that can send. Resend and Twilio are v2, and the PRD gates going live on one
  existing. v1 ships `NoopProvider`, which fails loudly and on purpose.
- Scheduling UI beyond "now or a chosen time". Sequences are v2.

---

## 2. The state machine

Pure: a status and an event in, the next status or a refusal out. No database, no clock, no
side effects — so every path can be tested, and every caller gets the same answer.

| From | Event | To | Notes |
| --- | --- | --- | --- |
| `waiting` | approve, sandbox | `sent` | mode `sandbox`; nothing is delivered |
| `waiting` | approve, live | `scheduled` | `sendAt` = now or a chosen time |
| `waiting` | reject | `rejected` | |
| `waiting` | edit | `waiting` | payload replaced, the change recorded |
| `scheduled` | claim | `sending` | the delivery job taking the row |
| `scheduled` | reject | `rejected` | **added — see below** |
| `sending` | delivered | `sent` | mode `live` |
| `sending` | failed | `failed` | with a reason |
| `sending` | interrupted | `failed` | reason "interrupted", after 15 minutes |
| `failed` | requeue | `waiting` | back to Devon, not straight back to the queue |

Everything else is refused, with a message that says why — a second approve on something already
decided returns **"That has already been decided."** rather than doing it twice.

**Added beyond the PRD's table: `scheduled → rejected`.** Approving something is not the last
moment Devon is allowed to change his mind. Without this, a message approved for later could not
be stopped, which contradicts the premise the whole module exists for. A claimed row
(`sending`) is past the point of recall and is not cancellable.

**`failed` requeues to `waiting`, not to `scheduled`.** Something that failed deserves a fresh
look before it is sent again.

---

## 3. Creating one

```
createApproval({ kind, payload, contactId?, arena, idempotencyKey, createdBy })
```

The only way any module, automation or the Operator expresses an outbound action. Nothing else
in the codebase may call a provider.

**Payloads, by kind**, validated with zod:

| Kind | Payload |
| --- | --- |
| `email` | `{ to, subject, body }` |
| `text` | `{ to, body }` |
| `calendar_write` | `{ calendarId, event: { title, startsAt, endsAt, allDay?, location?, notes? } }` |

`other` stays in the enum for a later milestone and is **refused** at creation: inventing a
schema nobody has asked for is how a payload ends up unvalidated.

**Refusals:**

- A contact marked `do_not_contact` — M6's `assertContactable`, the guard written one milestone
  early for exactly this call site.
- A payload that does not match its kind.
- A recipient that is empty.

**The idempotency key is not a uniqueness error.** A repeat with the same key returns the
approval that already exists, and says it was not newly created. A retried Operator tool call or
a double-clicked automation must not produce two drafts of the same message.

---

## 4. Delivery

The `approvals-deliver` job, every 5 minutes.

1. **Sweep** rows stuck in `sending` for more than 15 minutes back to `failed` with reason
   "interrupted". A process that died mid-delivery must not strand a row forever.
2. **Claim** due rows atomically:
   `update … set status='sending' where status='scheduled' and send_at <= now() returning *`.
   The database decides who gets the row, so two ticks overlapping cannot both deliver it.
3. **Deliver** each claimed row through the provider for its kind, passing the idempotency key
   to any provider that supports one.
4. Record `sent`, or `failed` with the reason.

**Sandbox never reaches this.** A sandbox approval goes straight to `sent` at the moment of
approval, with a timeline row reading "Sandbox: would have sent …". There is no code path from
sandbox to a provider — not a flag that is checked, but a different branch that ends before
delivery exists.

### Providers

```
DeliveryProvider = { kind, name, supportsIdempotency, deliver(payload, idempotencyKey) }
```

v1 registers **`NoopProvider`** for every kind. It fails with "No email provider connected" and
the equivalent for the others. That is not a placeholder to be tidied later — it is the
guarantee that v1 cannot send, written as code rather than as a promise.

### Going live is blocked

Settings' go-live switch already demands typing LIVE. It now also refuses while no real provider
is configured, with a message saying so. The typed confirmation guards intent; this guards
capability, and both have to pass.

---

## 5. `/approvals`

Tabs: **Waiting · Scheduled · Failed · History**. State in the URL, as everywhere since M2.

Each card carries the kind, the recipient, the contact, who drafted it (Devon, the Operator or
an automation), the arena, and the full payload in an editable form.

- **Pressing Enter in a card saves. It never approves.** Approving is a deliberate, separate
  press. This is the one screen where a reflex must not be able to send something.
- Approve, Reject and Edit on Waiting. Reject on Scheduled. Requeue on Failed.
- Every card says the mode it would be decided under, so "nothing will be delivered" is visible
  at the moment of the decision rather than buried in Settings.

---

## 6. Schema

| Change | Detail |
| --- | --- |
| `approval_status` gains `sending` | The claimed state between scheduled and sent |

Nothing else. The table has carried `mode`, `sendAt`, `decidedAt`, `failureReason` and a unique
`idempotencyKey` since Phase 0, which is what makes this milestone mostly logic.

---

## 7. Acceptance criteria

1. **In sandbox, approving an email moves it to History as sent**, records mode `sandbox`, and
   writes a timeline row — **and no provider is called**, asserted with a spy. ✔ test
2. **A double-submitted approve makes one transition**; the second returns "already decided".
   ✔ test
3. **The Command tile matches the Waiting tab count.** ✔ test
4. **Every transition in §2 is tested**, and every refusal returns a message rather than
   throwing. ✔ test
5. **A `do_not_contact` contact cannot have an approval created.** ✔ test
6. **A repeated idempotency key returns the existing approval**, and creates nothing. ✔ test
7. **Claiming is atomic**: two overlapping deliveries claim disjoint rows. ✔ test
8. **A row stuck in `sending`** for over 15 minutes becomes `failed` with reason "interrupted".
   ✔ test
9. **Delivery in v1 always fails** with "No … provider connected", and the row lands in Failed
   with that reason. ✔ test
10. **Going live is refused** while no real provider exists, even with LIVE typed. ✔ test
11. **A bad payload is refused** for each kind. ✔ test
12. **The registered job definition** runs through `runJob` and never throws. ✔ test
13. `npm run check` is green.

---

## 8. Accepted trade-offs

- **v1 genuinely cannot send.** Devon will approve things in sandbox for a week and nothing will
  leave. That is the PRD's plan (§10's gate to v2 is exactly that week), and a provider that
  half-worked would be worse than one that honestly refuses.
- **No provider retries.** A failed row goes to Failed and waits for Devon. Automatic retry of
  an outbound message is how one send becomes three.
- **Claim-and-sweep rather than a queue.** A dedicated queue would be more machinery than a
  single-owner instance with a 5-minute tick needs, and `UPDATE … RETURNING` is already atomic.

---

## 9. Changed during BUILD

### The mode is read from settings, never from the form

`approveAction` asks `getSettings()` for the delivery mode rather than taking it from a
submitted field. A posted `mode=live` must not be able to assert its way past sandbox — in a
module whose entire job is refusing to send, the one value that decides whether something sends
cannot come from the request.

### `editApproval` writes its own update rather than going through `apply`

Every status change goes through the machine, but an edit changes the *payload* and leaves the
status alone. It still asks the machine whether an edit is allowed from the current status, then
does a compare-and-set on `status = 'waiting'`, so a draft edited at the same moment it is
approved cannot overwrite the approved version.

### The delivery job records v1's failures as failures

With no provider connected every delivery fails, so the job throws and the run is recorded as
`error` with the reason. Reporting a run where nothing could be sent as `ok` would make the
Settings job history useless exactly when it matters. "Nothing due" stays a `skipped`.

### The M1 cron test, again

`tests/cron.route.test.ts` asserted `approvals-deliver` reported "Ships in M8." — the second
time a milestone has had to retire that stub assertion (M4 was the first). It now asserts the
real reason. One stub remains: `daily-brief`, which M9 will replace.
