# PLAN-001 · M1 Foundations

**Spec:** `docs/specs/SPEC-001-foundations.md` · **Branch:** `m1-foundations`
**Status:** SHIPPED 2026-11-02

Seven tasks, each small enough to finish and typecheck on its own. Nothing here touches a module
outside M1.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/lib/crypto.ts` | AES-256-GCM `encrypt`/`decrypt` |
| `src/lib/encryption-key.ts` | `getEncryptionKey()`, mirroring `auth/secret.ts` |
| `src/modules/jobs/schedule.ts` | pure `isJobDue` + schedule types |
| `src/modules/jobs/registry.ts` | the four v1 jobs with M1 stub handlers |
| `src/modules/jobs/service.ts` | `runJob`, `runDueJobs` |
| `src/modules/jobs/queries.ts` | `recentRunsByJob(db, perJob)` |
| `src/app/api/cron/tick/route.ts` | bearer check → `runDueJobs` |
| `src/app/api/export/route.ts` | JSON export download |
| `src/lib/settings-rules.ts` | pure validators: time zone, protected block |
| `vercel.json` | cron entry |
| `tests/crypto.test.ts` | round-trip + tamper |
| `tests/jobs.schedule.test.ts` | due logic, all kinds, DST |
| `tests/jobs.service.test.ts` | `runJob` / `runDueJobs` against PGlite `memory://` |
| `tests/settings-rules.test.ts` | validators |
| `tests/export.test.ts` | shape + no secret fields |
| `tests/helpers/db.ts` | in-memory PGlite + migrations for service tests |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `jobStatusEnum`, `jobRuns` table |
| `drizzle/0001_foundations.sql` (+ meta) | generated, committed, never hand-edited |
| `src/middleware.ts` | `/api/cron` joins `PUBLIC_PATHS` |
| `src/lib/settings-actions.ts` | `setTimezoneAction`, `addProtectedBlockAction`, `removeProtectedBlockAction`; existing actions gain `requireOwner()` |
| `src/app/(os)/settings/page.tsx` | time zone, protected time, export, job runs sections |
| `src/app/(os)/settings/forms.tsx` | the new client forms |
| `src/components/form.tsx` | `Select` + non-full-width button variant, if the forms need them |
| `.env.example` | note that `ENCRYPTION_KEY` is now used |
| `README.md` | M1 commands, cron setup, Hobby cron caveat, export |
| `docs/build-log.md` | the SHIP entry |

---

## Tasks

**T1 · Crypto.** `encryption-key.ts` then `crypto.ts`. Tests first: the tamper cases are the
point of the module. `ENCRYPTION_KEY` must be exactly 32 bytes once base64-decoded.

**T2 · Schema + migration.** Add `jobStatusEnum` and `jobRuns` to `src/db/schema.ts`, then
`npm run db:generate -- --name foundations`. Read the SQL before committing it; confirm the index
is `(job, started_at desc)`.

**T3 · Job schedules.** `schedule.ts` as pure functions over `(schedule, lastRunStartedAt, now,
timeZone)`. Needs a local-time-of-day helper and a local-weekday helper — both go in
`src/lib/dates.ts` beside `dateInZone`, since M3's conflict rule will want them too.

**T4 · Runner + registry.** `service.ts` (`runJob`, `runDueJobs`) and `registry.ts` with the four
stubs. `runDueJobs` reads the last run per job in one query, decides due-ness, runs sequentially,
catches everything. Service tests use PGlite `memory://` through `tests/helpers/db.ts`.

**T5 · Cron route + vercel.json.** Bearer compare with `timingSafeEqual` on equal-length buffers.
Add `/api/cron` to `PUBLIC_PATHS`. Route tests call the exported `GET` directly with a crafted
`Request`.

**T6 · Settings editors.** `settings-rules.ts` validators first (pure, tested), then the actions,
then the forms and the page sections. Each form keeps its input on error and reports through
`FormMessage` (`role="alert"` / `role="status"` — covers the `aria-live` requirement in PRD §9).

**T7 · Export.** `/api/export` route: session check, read every table, strip `passwordHash` and
`encryptedKeys`, attachment headers. The test asserts the stripped keys appear nowhere in the
serialised string, not just that the properties are undefined.

**T8 · Ship.** README, `.env.example`, `npm run check`, `npm audit --omit=dev`, diff read against
the spec, build-log entry, push.

---

## Schema change

```
job_status enum: ok | error | skipped
job_runs: id uuid pk, job text, started_at tz, finished_at tz,
          status job_status, detail text, created_at tz, updated_at tz
index job_runs_job_started_idx (job, started_at desc)
```

No foreign keys, so nothing to index beyond that. No change to any existing table.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8. T3 and T6 both add to `src/lib/dates.ts` and
`settings-*`, so they stay in order rather than interleaved.

| Risk | Handling |
| --- | --- |
| Middleware would 401 the cron before the route sees the bearer | T5 adds `/api/cron` to `PUBLIC_PATHS`; a test asserts the route's own 401 |
| `Intl.supportedValuesOf` renders ~600 options | Acceptable (one `<select>`, ~15 KB). If it becomes a problem, M10 can swap in a datalist — token-level change, not structural |
| PGlite single-process lock | Service tests use `PGLITE_DIR=memory://` per the PRD; the helper sets it before importing the client |
| `drizzle-kit generate` wanting an interactive answer | Pass `--name`; if it still prompts, write the SQL by hand into a new numbered file and update `_journal.json` by the same shape as `0000` |
