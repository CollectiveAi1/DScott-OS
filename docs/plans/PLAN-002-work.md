# PLAN-002 · M2 Work + Misc capture

**Spec:** `docs/specs/SPEC-002-work.md` · **Branch:** `m2-work` (stacked on `m1-foundations`)
**Status:** SHIPPED 2026-11-02

M2 is the largest v1 milestone. Ten tasks, ordered so each one typechecks on its own and the pure
rules land before anything renders them.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/modules/work/capture.ts` | pure `parseCapture` |
| `src/modules/work/filters.ts` | pure filter parsing from `URLSearchParams` + due-window maths |
| `src/modules/work/queries.ts` | inbox, board, list, projects, drawer, needs-attention reads |
| `src/modules/work/service.ts` | capture, triage, move, complete, delete, update, projects |
| `src/modules/work/actions.ts` | `"use server"` wrappers: zod, `requireOwner()`, revalidate |
| `src/modules/work/components/quick-capture.tsx` | the capture input, used twice |
| `src/modules/work/components/task-card.tsx` | card + Move to… + Complete |
| `src/modules/work/components/inbox.tsx` | Misc inbox rows and their triage form |
| `src/modules/work/components/filters.tsx` | the filter bar |
| `src/modules/work/components/task-drawer.tsx` | the drawer form |
| `src/app/(os)/work/page.tsx` | board + list + inbox + drawer |
| `src/app/(os)/work/projects/page.tsx` | projects |
| `src/components/arena-tag.tsx` | colour + label, always both |
| `src/components/mobile-nav.tsx` | menu button for the sidebar under `md` |
| `tests/work.capture.test.ts` | every token, every edge |
| `tests/work.filters.test.ts` | filter parsing and due windows |
| `tests/work.service.test.ts` | triage, move, complete, delete, counts (PGlite) |
| `tests/work.queries.test.ts` | inbox order, board grouping, needs-attention, filters (PGlite) |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `tasks.notes`, two indexes |
| `drizzle/0002_work.sql` (+ meta) | generated, committed |
| `src/app/globals.css` | four arena tokens |
| `src/components/sidebar.tsx` | Work becomes a link; mobile menu behaviour |
| `src/app/(os)/layout.tsx` | top bar under `md`, room for the fixed capture bar |
| `src/app/(os)/page.tsx` | quick capture, Needs attention, corrected empty-state copy |
| `src/lib/command.ts` | stale-capture count for Needs attention |
| `src/components/form.tsx` | `Textarea`, and `Select` taking `{value,label}` options |
| `README.md`, `docs/build-log.md` | status table, SHIP entry |

---

## Tasks

**T1 · Schema.** `tasks.notes`, `tasks_misc_idx`, `tasks_arena_status_idx`, then
`npm run db:generate -- --name work`. Read the SQL before committing.

**T2 · Capture parser.** Tests first — the PRD's own example is the first case. Needs a
weekday-from-date helper in `src/lib/dates.ts` (M3's conflict rule will want it too).

**T3 · Filters.** Pure: `URLSearchParams` → a typed filter object, and a due window → SQL bounds
computed in the settings zone. Tested without a database.

**T4 · Queries + service.** Reads and writes together, since the service tests read back through
the queries. Services return the `Result` shape from PRD §6.1; actions translate to `FormState`.

**T5 · Actions.** One `"use server"` file. Every action: zod-validate, `requireOwner()`, call the
service, `revalidatePath`. Never a raw DB error to the screen.

**T6 · Shared UI.** Arena tokens, `ArenaTag`, `Textarea`, `Select` with labelled options,
mobile nav. Small and used by everything after it.

**T7 · `/work`.** Inbox, filter bar, board view, list view, drawer. The biggest task; build board
view first, then list, then the drawer.

**T8 · `/work/projects`.** List, create, status change, done/total.

**T9 · Command.** Quick capture, Needs attention, copy fix, Work linked in the sidebar.

**T10 · Ship.** `npm run check`, `npm audit --omit=dev`, browser pass at 1280 and 375,
diff read against the spec, README, build log, push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10. T2 and T3 are independent of each other but
both precede T4, which consumes them.

| Risk | Handling |
| --- | --- |
| React 19 clears a form once its action settles (found in M1) | Every multi-field form here — triage, drawer, project create — is controlled or keyed from the start. This is the M1 build-log warning being spent. |
| The drawer and the board competing for one page's state | All of it is query parameters; the page is one server render with no client state to desynchronise |
| Filter combinations missing an index | `(status, due)`, `(arena, status)` and `(from_misc, created_at)` cover the shipped shapes; anything else is a small table scan on a single-owner instance |
| Scope: ten tasks is a long session | T1–T6 are self-contained and leave the tree green; a handoff after any of them is clean |
