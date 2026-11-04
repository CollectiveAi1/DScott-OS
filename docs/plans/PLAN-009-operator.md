# PLAN-009 · M9 Operator + daily brief

**Spec:** `docs/specs/SPEC-009-operator.md` · **Branch:** `m9-operator`
**Status:** SHIPPED 2026-11-04

Eight tasks. The order is deliberate: the two things with no model in them — the free-slot
finder and the brief — land first, then the tool registry, then the loop, then the screen. By the
time a model is involved, everything it can reach is already tested.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/modules/schedule/free-slots.ts` | the pure gap finder |
| `src/modules/operator/brief.ts` | `buildBrief` — pure |
| `src/modules/operator/render-brief.ts` | the deterministic template |
| `src/modules/operator/brief-service.ts` | inputs, summarise, upsert the digest |
| `src/modules/operator/prompt.ts` | the system prompt, versioned |
| `src/modules/operator/registry.ts` | the tool registry and its types |
| `src/modules/operator/tools/*.ts` | one file per tool group (6 files) |
| `src/modules/operator/client.ts` | the injected model interface + the real client |
| `src/modules/operator/loop.ts` | `runTurn` — rounds, timeout, tool dispatch |
| `src/modules/operator/service.ts` | threads, messages, a turn end to end |
| `src/modules/operator/queries.ts` | thread list, one thread, 30-day usage |
| `src/modules/operator/actions.ts` | `"use server"` wrappers |
| `src/modules/operator/components/*.tsx` | thread list, message, tool calls, composer |
| `src/app/(os)/operator/page.tsx` | the screen |
| `tests/schedule.free-slots.test.ts` | gaps, all-day, protected time, DST |
| `tests/operator.brief.test.ts` | the pure brief and its template |
| `tests/operator.tools.test.ts` | every handler, no model (PGlite) |
| `tests/operator.registry.test.ts` | the write-tool allow-list |
| `tests/operator.loop.test.ts` | scripted tool calls, errors, the round cap |
| `tests/operator.service.test.ts` | a turn end to end, offline mode, the brief job (PGlite) |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `operator_threads`, `operator_messages`, `operator_role`, `tool_status` |
| `drizzle/0009_operator.sql` (+ meta) | generated, committed |
| `src/modules/jobs/registry.ts` | the real `daily-brief` handler — the last stub |
| `src/lib/command.ts` | today's brief in the snapshot |
| `src/app/(os)/page.tsx` | the brief panel with Regenerate |
| `src/app/(os)/settings/page.tsx` | the 30-day token total |
| `src/components/sidebar.tsx` | Operator becomes a link |
| `tests/cron.route.test.ts` | the last stub assertion retires |
| `README.md`, `docs/build-log.md` | status, SHIP entry |

---

## Tasks

**T1 · Schema.** Both tables, both enums, then `npm run db:generate -- --name operator`.

**T2 · Free slots.** Pure, tests first: gaps around timed events, all-day events making a day
busy, protected blocks, working-hours bounds, a DST day. No model, no database.

**T3 · The brief.** `buildBrief` + `renderBrief` pure and tested on fixed data, then the service
that gathers inputs, calls M7's `summarise` contract and upserts the digest. Then the job body
and the Command panel. The brief is useful on its own, before any chat exists.

**T4 · The registry.** The tool type, `effect`, the dispatcher, and the allow-list test. Six tool
files, each thin over an existing module function. `messages.draft` goes through
`createApproval` and nothing else.

**T5 · The prompt.** Versioned, with the rules from SPEC §4.1.

**T6 · The loop.** `runTurn` with the injected client: rounds, the 60 s budget, zod validation of
each call, tool rows written as they run, the round cap, API errors. Tested entirely with a
stub.

**T7 · The screen.** Threads in the URL, messages, tool calls in a collapsed `<details>`, the
composer, the offline state, the Approvals link when a draft was made. Settings' token total.

**T8 · Ship.** `npm run check`, `npm audit --omit=dev`, a browser pass (a real turn against a
stub is not possible in the browser, so: offline state, a seeded thread renders, the brief panel,
Regenerate, 375 px), README, build log, push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8.

| Risk | Handling |
| --- | --- |
| **A tool existing that can send or delete** | `effect` is declared per tool and a test asserts the write set equals an explicit list. Adding one is a deliberate edit to a test |
| **Injection through a calendar title or contact note** | Contained rather than prevented: the worst case is a draft in Approvals or a task. Tool results are wrapped as data; the prompt says so but is not relied on |
| `free_slots` offering time inside a game | Pure function, tested against all-day events, protected time and DST before anything calls it |
| A turn looping forever | 8 rounds and a 60 s budget, both tested; the assistant says it stopped |
| A model outage making the OS feel broken | The brief falls back to the template, `/operator` degrades to an offline message, nothing else depends on a key |
| Cost running away unseen | Usage per turn on the assistant row, a 30-day total in Settings |
| A brief written twice | Unique `(kind, day)`; Regenerate is an upsert |
