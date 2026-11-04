# PLAN-007 · M7 Learning

**Spec:** `docs/specs/SPEC-007-learning.md` · **Branch:** `m7-learning`
**Status:** SHIPPED 2026-11-04

Six tasks. The review is pure data before it is ever prose, and prose before it is ever a job.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/modules/learning/review.ts` | pure: data in, a `LearningReview` out |
| `src/modules/learning/render.ts` | the deterministic offline template |
| `src/modules/learning/summary.ts` | the model rewrite, injected client, offline fallback |
| `src/modules/learning/queries.ts` | skills with their totals, a skill page, the latest digest |
| `src/modules/learning/service.ts` | skills, items, practice, and writing the review |
| `src/modules/learning/actions.ts` | `"use server"` wrappers |
| `src/modules/learning/components/*.tsx` | the list, the skill page, quick-log |
| `src/app/(os)/learning/page.tsx`, `[id]/page.tsx` | the two screens |
| `tests/learning.review.test.ts` | every rule in SPEC §3, against fixed data |
| `tests/learning.render.test.ts` | determinism, and the numbers being ours |
| `tests/learning.service.test.ts` | totals, additive logging, one row per day (PGlite) |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `digests` |
| `drizzle/0007_learning.sql` (+ meta) | generated, committed |
| `src/modules/jobs/registry.ts` | the real `learning-review` handler |
| `src/components/sidebar.tsx` | Learning becomes a link |
| `src/app/(os)/page.tsx` | a link to the latest review |
| `.env.example`, `README.md`, `docs/build-log.md` | `SUMMARY_MODEL`, SHIP entry |

---

## Tasks

**T1 · Schema.** `digests` with its unique `(kind, day)`, plus `source` and `data`, then
`npm run db:generate -- --name learning`.

**T2 · The review.** `review.ts`, tests first: week boundaries, stalled, past due, and the
next-step ladder rung by rung.

**T3 · Rendering.** The offline template, asserted deterministic and asserted to carry the
computed numbers rather than inventing any. Then `summary.ts` over an injected client, with the
offline text as its fallback.

**T4 · Queries + service.** Skills with 7- and 30-day totals, the skill page, practice logging,
and `writeReview` — one row per day, upserted.

**T5 · Screens + job.** `/learning` with the review on top, the skill page with quick-log, the
real job handler, the Command link, the sidebar link.

**T6 · Ship.** `npm run check`, `npm audit --omit=dev`, a browser pass including logging 30
minutes and writing a review on demand, README, build log, push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6.

| Risk | Handling |
| --- | --- |
| A model inventing a total | The model is handed resolved numbers and asked only to phrase them; a test asserts the offline text carries the computed figures |
| A review accumulating rows on retries | Unique `(kind, day)` and an upsert; tested by running it twice |
| Week boundaries drifting from the rest of the OS | `startOfWeek` from `src/lib/zoned.ts`, the same Monday the schedule uses |
| Totals computed off the server's clock | Days resolve in the settings time zone, as everywhere since M1 |
| Optional form fields | `src/lib/form-fields.ts` from M6 — absent and empty mean the same |
