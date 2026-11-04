# PLAN-008 · M8 Approvals engine

**Spec:** `docs/specs/SPEC-008-approvals.md` · **Branch:** `m8-approvals`
**Status:** SHIPPED 2026-11-04

Six tasks. The state machine and the payload schemas are pure and land first, because they are
the two places a mistake here reaches a person.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/modules/approvals/machine.ts` | the pure state machine |
| `src/modules/approvals/payloads.ts` | a zod schema per kind, and the recipient of each |
| `src/modules/approvals/providers.ts` | `DeliveryProvider`, the registry, `NoopProvider` |
| `src/modules/approvals/service.ts` | create, decide, edit, claim, deliver, sweep |
| `src/modules/approvals/queries.ts` | the four tabs and their counts |
| `src/modules/approvals/actions.ts` | `"use server"` wrappers |
| `src/modules/approvals/components/card.tsx` | one approval, editable, with its decisions |
| `src/app/(os)/approvals/page.tsx` | the tabs |
| `tests/approvals.machine.test.ts` | every transition and every refusal |
| `tests/approvals.payloads.test.ts` | each kind, each bad shape |
| `tests/approvals.service.test.ts` | create, sandbox approve, idempotency, do-not-contact (PGlite) |
| `tests/approvals.delivery.test.ts` | claim, sweep, noop failure, the job definition (PGlite) |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `approval_status` gains `sending` |
| `drizzle/0008_approvals.sql` (+ meta) | generated, committed |
| `src/modules/jobs/registry.ts` | the real `approvals-deliver` handler |
| `src/lib/settings-actions.ts` | going live refused with no provider |
| `src/components/sidebar.tsx` | Approvals becomes a link |
| `src/app/(os)/page.tsx` | the waiting tile links to the Waiting tab |
| `README.md`, `docs/build-log.md` | status, SHIP entry |

---

## Tasks

**T1 · Schema.** Add `sending` to the enum, then `npm run db:generate -- --name approvals`.

**T2 · The machine.** Pure, tests first, every row of SPEC §2 plus the refusals. This is the
file that decides whether anything can be sent twice.

**T3 · Payloads and providers.** A schema per kind with its recipient; the provider interface
and `NoopProvider`. A test asserts `hasRealProvider()` is false in v1 — if that ever flips by
accident, the suite says so.

**T4 · Service.** Create (idempotent, do-not-contact refused), decide, edit, and the
sandbox branch that reaches `sent` without a provider in sight. A spy proves it.

**T5 · Delivery + go-live.** Sweep, atomic claim, deliver, the real job handler, and the
Settings refusal. Then the screen.

**T6 · Ship.** `npm run check`, `npm audit --omit=dev`, a browser pass over all four tabs and a
sandbox approval, README, build log, push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6.

| Risk | Handling |
| --- | --- |
| **Anything reaching a provider in sandbox** | Sandbox is a different branch that terminates at `sent`, not a flag checked before delivery. A spy provider asserts it is never called |
| A double click sending twice | The machine refuses a second decision, and the claim is a single atomic `UPDATE … RETURNING` |
| A dead process stranding a row in `sending` | A 15-minute sweep to `failed` with reason "interrupted", tested |
| Going live becoming possible by accident | `hasRealProvider()` is false in v1 and a test asserts it; the Settings action refuses on it |
| Enter in a card approving something | The approve control is a separate button outside the editable form; a test of the markup is not enough, so the browser pass checks it |
