# PLAN-005 · M5 Basketball schedule import

**Spec:** `docs/specs/SPEC-005-schedule-import.md` · **Branch:** `m5-schedule-import`
**Status:** SHIPPED 2026-11-03

Seven tasks. The parser and the diff are pure and land first; the screen is the last thing built,
because by then there is nothing left to discover.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/modules/import/csv.ts` | RFC 4180 reader: text → rows of cells |
| `src/modules/import/parse.ts` | rows → typed events, or per-row errors |
| `src/modules/import/identity.ts` | the normalised hash, and move pairing |
| `src/modules/import/plan.ts` | pure diff: parsed events + existing rows → a preview |
| `src/modules/import/model.ts` | text/PDF/image through Claude, injected client |
| `src/modules/import/service.ts` | preview and confirm against the database |
| `src/modules/import/actions.ts` | `"use server"` wrappers |
| `src/modules/import/components/importer.tsx` | the screen |
| `src/app/(os)/schedule/import/page.tsx` | the route |
| `docs/samples/basketball-schedule.csv` | the labelled sample |
| `tests/import.csv.test.ts` | quoting, tabs, ragged rows |
| `tests/import.parse.test.ts` | every column, every default, every error |
| `tests/import.plan.test.ts` | new/changed/unchanged/removed, and moves |
| `tests/import.service.test.ts` | the sample end to end, twice, then edited (PGlite) |
| `tests/import.model.test.ts` | schema validation of model output, no network |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `calendar_events.import_batch` + index |
| `drizzle/0005_import.sql` (+ meta) | generated, committed |
| `src/app/(os)/schedule/page.tsx` | a link to the importer |
| `package.json` | `@anthropic-ai/sdk` (named in PRD §6; not a new vendor) |
| `.env.example`, `README.md`, `docs/build-log.md` | the model key, the id correction, SHIP entry |

---

## Tasks

**T1 · Schema.** `import_batch` and its index, then `npm run db:generate -- --name import`.

**T2 · CSV reader.** Pure, tests first: quoted commas, quoted newlines, escaped quotes, tabs,
ragged rows, a trailing newline, a BOM.

**T3 · Parse.** Headers, dates, times, types, the end-time defaults, travel, per-row errors with
line numbers. The biggest pure surface in the milestone and the one Devon will feel.

**T4 · Identity and plan.** The hash, then the diff: new, changed, unchanged, removed, and the
move pairing with its ambiguity fallback.

**T5 · Service.** Preview and confirm over PGlite, including the sample file end to end, a
second identical run, and a single edited row.

**T6 · Model path.** `model.ts` with an injected client, a strict schema, row-by-row validation,
and the untrusted-document framing. Disabled with a reason when there is no key.

**T7 · Screen and ship.** The importer page, `npm run check`, `npm audit --omit=dev`, a browser
pass including the sample, README, build log, push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6 → T7.

| Risk | Handling |
| --- | --- |
| A wrong import quietly deleting a season | Removal is future-only, requires Confirm, and the preview names every row that would go. Tested from both sides |
| The hash making a time edit look like add + remove | Move pairing, only when unambiguous; tested including the ambiguous case |
| An uploaded PDF exceeding the server action body limit | Raised deliberately in `next.config.ts` with a stated ceiling, and a clear message above it |
| A hostile document steering the model | No tools, document framed as data, and every row still faces the preview before anything is written |
| Model ids in the PRD that do not exist | `claude-sonnet-5` via `OPERATOR_MODEL`, recorded in the spec, the README and the build log |
