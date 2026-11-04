# PLAN-006 · M6 Contacts + Pipelines

**Spec:** `docs/specs/SPEC-006-contacts-pipelines.md` · **Branch:** `m6-contacts-pipelines`
**Status:** SHIPPED 2026-11-03

Eight tasks. The pure rules — money, business days, next-step state — land first; the handoffs
land before the screens, because "exactly once" is the thing most worth proving early.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/modules/crm/money.ts` | `$1,250` ↔ cents |
| `src/modules/crm/dates.ts` | business days |
| `src/modules/crm/deal-state.ts` | next-step discipline, as a pure rule |
| `src/modules/crm/handoffs.ts` | the two handoff tasks, keyed and idempotent |
| `src/modules/crm/queries.ts` | contact search, contact page, boards, merged timeline |
| `src/modules/crm/service.ts` | contacts, orgs, deals, stage moves, pipeline settings |
| `src/modules/crm/actions.ts` | `"use server"` wrappers |
| `src/modules/crm/components/*.tsx` | list, contact page, board, forms |
| `src/app/(os)/contacts/page.tsx`, `[id]/page.tsx` | the two contact screens |
| `src/app/(os)/pipelines/page.tsx` | the boards |
| `tests/crm.money.test.ts`, `crm.dates.test.ts`, `crm.deal-state.test.ts` | the pure rules |
| `tests/crm.handoffs.test.ts` | exactly-once, both triggers (PGlite) |
| `tests/crm.timeline.test.ts` | the merged, cursor-paginated feed (PGlite) |
| `tests/crm.service.test.ts` | contacts, deals, stage moves, pipeline edits (PGlite) |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `pipelines.billing_stages`, `tasks.handoff_key` unique, timeline index |
| `drizzle/0006_crm.sql` (+ meta) | generated, committed |
| `scripts/seed.ts` | billing stages per pipeline |
| `src/components/sidebar.tsx` | Contacts and Pipelines become links |
| `src/app/(os)/settings/page.tsx` | the Pipelines panel |
| `src/modules/work/components/task-drawer.tsx` | contact and deal pickers, now that both exist |
| `README.md`, `docs/build-log.md` | status, SHIP entry |

---

## Tasks

**T1 · Schema + seed.** `billing_stages`, `handoff_key`, the timeline index, then
`npm run db:generate -- --name crm`, then the seed's billing stages.

**T2 · Pure rules.** Money, business days, deal state. Tests first; the PRD's `$1,250` case is
the first one written.

**T3 · Handoffs.** Both triggers, keyed, `on conflict do nothing`. Proven against PGlite before
anything can call them twice.

**T4 · Queries.** Search, the contact page's four reads, the boards, and the merged timeline
with its cursor.

**T5 · Service + actions.** Contacts, orgs, deals, stage moves (writing the timeline row and
firing the handoff), pipeline stage edits with the rename-moves-deals rule.

**T6 · Contacts screens.** List with search and type filters; contact page with details, deals,
tasks, timeline and the three log buttons.

**T7 · Pipelines + Settings.** The boards with next-step discipline and the move menu; the
Settings → Pipelines panel. Wire the task drawer's contact and deal pickers.

**T8 · Ship.** `npm run check`, `npm audit --omit=dev`, a browser pass over both screens and the
handoffs, README, build log, push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8.

| Risk | Handling |
| --- | --- |
| A handoff firing twice | A unique `handoff_key` and `on conflict do nothing`; tested by moving a deal out and back, and by firing the same move twice |
| A stage rename orphaning deals | The rename moves the deals in it, in the same transaction; removing a populated stage is refused with the count |
| The merged timeline repeating or skipping across pages | Cursor is `(createdAt, id)`, each source over-fetches the page size, and a test walks the whole feed asserting no repeats and no gaps |
| Money parsed into something plausible but wrong | Refuse what cannot be read; never round. Tested against the forms a person actually types |
| React 19 form reset | Controlled, and any select or checkbox keyed on a submit counter — the rule from M1–M3 |
