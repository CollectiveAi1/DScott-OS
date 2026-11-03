# PLAN-003 · M3 Schedule

**Spec:** `docs/specs/SPEC-003-schedule.md` · **Branch:** `m3-schedule`
**Status:** SHIPPED 2026-11-02

Eight tasks. The two pure modules — zone maths and the conflict rule — land and are fully tested
before a single pixel renders, because everything above them is only as correct as they are.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/lib/zoned.ts` | wall time ↔ instant, day/week/month grids, all in a named zone |
| `src/modules/schedule/conflicts.ts` | the pure rule, event × event and event × protected time |
| `src/modules/schedule/kinds.ts` | which kinds each arena offers, and their labels |
| `src/modules/schedule/queries.ts` | range reads, one event, conflicts in a window |
| `src/modules/schedule/service.ts` | create, update, delete, acknowledge |
| `src/modules/schedule/actions.ts` | `"use server"` wrappers |
| `src/modules/schedule/components/time-grid.tsx` | the Day and Week grid, protected time behind |
| `src/modules/schedule/components/agenda.tsx` | the list view |
| `src/modules/schedule/components/month.tsx` | the 6-week grid |
| `src/modules/schedule/components/event-form.tsx` | create and edit |
| `src/modules/schedule/components/event-chip.tsx` | one event, with its conflict badge |
| `src/modules/schedule/components/acknowledge.tsx` | the Acknowledge button |
| `src/app/(os)/schedule/page.tsx` | the four views |
| `src/app/(os)/schedule/new/page.tsx` | create |
| `src/app/(os)/schedule/[id]/page.tsx` | edit |
| `tests/zoned.test.ts` | round trips, DST, grids |
| `tests/schedule.conflicts.test.ts` | every row of the rule table |
| `tests/schedule.service.test.ts` | CRUD, acks, read-only sources, capture completion (PGlite) |
| `tests/schedule.queries.test.ts` | range reads and the conflict window (PGlite) |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `conflictAcks` |
| `drizzle/0003_schedule.sql` (+ meta) | generated, committed |
| `src/components/sidebar.tsx` | Schedule becomes a link |
| `src/lib/command.ts` | conflicts in the next 14 days |
| `src/app/(os)/page.tsx` | the Conflicts panel |
| `src/modules/work/components/inbox.tsx` | "Make event" becomes a real link |
| `README.md`, `docs/build-log.md` | status, SHIP entry |

---

## Tasks

**T1 · Zone maths.** `src/lib/zoned.ts` with tests first. The DST cases are the reason this file
exists, so they are written before the implementation. Existing helpers in `src/lib/dates.ts`
stay where they are; `zoned.ts` is the instant-aware layer above them.

**T2 · Schema.** `conflictAcks`, then `npm run db:generate -- --name schedule`. Check the unique
index and both FK indexes in the SQL before committing.

**T3 · Conflict rule.** Pure, table-driven tests mirroring §3 row by row.

**T4 · Queries, service, actions.** Range reads, conflict detection over a window with acks
applied, CRUD, ack, and the rule that an edit to an event's time clears its acks.

**T5 · Views.** `time-grid` first (Day is Week with one column), then Agenda, then Month, then
the page that chooses between them.

**T6 · Event form.** Create, edit, delete, read-only sources, arena-driven kinds, travel
defaults, prefill from a capture.

**T7 · Command + inbox.** The Conflicts panel, and "Make event" turning into a real link.

**T8 · Ship.** `npm run check`, `npm audit --omit=dev`, browser pass at 1280 and 375 across all
four views, diff read against the spec, README, build log, push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8.

| Risk | Handling |
| --- | --- |
| Zone maths wrong in a way tests do not catch | Tests assert against known UTC instants for `America/New_York` across both DST boundaries, plus a zone with no DST (`UTC`) and a half-hour zone (`Asia/Kolkata`) |
| The time grid is the biggest single piece of UI in v1 so far | Day and Week share one component; the grid is CSS rows, not absolute pixel maths, so a wrong row is visibly wrong rather than subtly off |
| All-day semantics leaking | One pair of helpers converts inclusive form dates to exclusive storage and back; nothing else does that arithmetic |
| Conflict noise from all-day events (spec §3) | Built as the PRD states, flagged for Devon at the M4 gate, isolated to one branch of the rule |
| React 19 form reset | Every form controlled or keyed from the start, as in M2 |
