# Build log

Decisions and changes at each gate. This log becomes the template for the next OS.

## 2026-10-31 · Phase 0 · Scaffold

- Arenas set by Devon: Collective AI (tasks, projects, learning and skills), Basketball (practices, S&C, team events, games, travel), Family (synced from his Gmail calendar), Misc.
- Kinetic Edge, Civic Sports and client builds fold into the Collective AI arena.
- Basketball schedule import waits on the official team schedule.
- Look defaulted to the Collective AI parent skin (navy/gold, Space Grotesk) since the look decision is still open; all colors and fonts are tokens in `globals.css`.
- Local dev runs on embedded Postgres (PGlite) so the app works with zero keys; production uses Supabase via `DATABASE_URL`.
- Auth: single owner, scrypt + signed cookie, session version in the DB for sign-out-everywhere. Middleware runs on the Node runtime.
- Delivery mode starts in sandbox. Going live requires typing LIVE.
- Gate to v1: the app runs locally end to end (setup, sign-in, Command, Settings). Passed: typecheck, 10 unit tests, production build, form flows exercised against `next start`.

## 2026-11-01 · Context update

- Adopted the DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP method. Specs, plans, ADRs and handoffs have fixed homes (see `docs/CONTEXT.md`).
- Added `npm run check` as the single SHIP gate.
- Operator is the Orchestrator role; v3 workers (Windows-MCP, Conductor, Voicebox) share one task payload contract and stay behind Approvals.
- Mox noted as the self-hosted mail option for resold OS builds; Resend stays the default.

## 2026-11-02 · M1 · Foundations

Branch `m1-foundations`. Spec `docs/specs/SPEC-001-foundations.md`, plan `docs/plans/PLAN-001-foundations.md`.

**Shipped**

- `src/lib/crypto.ts`: AES-256-GCM, `v1:<iv>:<tag>:<ciphertext>` base64url, 12-byte IV per call. `ENCRYPTION_KEY` must decode to 32 bytes; local dev generates `.data/dev-encryption-key` the way `AUTH_SECRET` already did.
- `job_runs` table (migration `0001_foundations`), indexed `(job, started_at desc)`.
- `src/modules/jobs/`: pure `isJobDue`, `runJob` (never throws), `runDueJobs` (sequential, failure-tolerant), and a registry of all four v1 jobs.
- `GET /api/cron/tick` behind `CRON_SECRET`, plus `vercel.json` at `*/5 * * * *`.
- Settings: time zone editor, protected-time editor (≤ 10 blocks), data export, last 10 runs per job.
- `GET /api/export`: every table as one JSON download, password hash and encrypted keys withheld.

**Decided at this gate**

- **All four jobs registered now, with stub handlers that report `skipped`.** M4, M7, M8 and M9 each replace one function body and touch nothing else. The schedule, the recording and the `{ran, skipped}` contract are provable before any integration exists.
- **Three schedule kinds** (`interval`, `dailyAfter`, `weeklyAfter`) cover every v1 job. `interval` carries a one-minute grace so a 5-minute cron does not defer a 10-minute job by a whole tick.
- **One tick, one clock.** `runJob` stamps `started_at` from the tick's `now` rather than the wall clock, so the due check and the recorded history can never disagree and jobs are testable with an injected clock.
- **A run is recorded only when a job is actually invoked**, and on completion. There is no `running` status: a crashed job leaves no row instead of a row that lies.
- **A failed job is a row, not an exception.** `runJob` swallows handler failures into `status = "error"` with a one-line sanitised detail, so one broken job cannot take down a tick.
- **The Bearer scheme is required** on the cron route, not merely tolerated. A bare token is refused. `/api/cron` joined `PUBLIC_PATHS` because the route authenticates itself.
- **No `CRON_SECRET` returns 503, not 401.** A half-configured deployment says it is misconfigured instead of looking like a credentials problem.
- **Export withholds by column name** (`passwordHash`, `encryptedKeys`) and the test scans the serialised file, not the parsed object, so a future table carrying either name is covered too.
- **`isSupportedTimeZone` validates on the server** against `Intl.supportedValuesOf("timeZone")`, so a forged POST cannot put junk in `settings.timezone`.
- **The block cap lives in the rule, not the UI.** `parseProtectedBlock` takes the current count and refuses the eleventh.

**Found while building**

- `runDueJobs` read the last run from the global registry instead of the job list it was given, so any injected list always looked like a first run. Caught by a service test; it would have shown up as duplicate work the first time a milestone ran a job outside the registry.
- **React 19 resets a form once its action settles.** A rejected protected-time block threw away everything Devon had typed, against the "keeps form input on error" rule in PRD §8.0. The fields are now controlled, and the day checkboxes remount per submit — React's reset clears them in the DOM while its own tree still says checked, so there is no diff to put them back. The time-zone select is keyed on the saved value for the same reason. **Any later form with more than one field needs this treatment; the other v1 screens are full of them.**
- `server-only` resolves to its client build under vitest and throws. Aliased to the package's own `empty.js` in `vitest.config.ts`.
- PGlite plus migrations takes longer than vitest's default 10 s hook timeout; raised to 60 s.

**Deferred**

- **Pruning `job_runs`.** Every tick that finds a job due writes a row: roughly 430 a day at a 5-minute cron, 4 a day on Hobby. Reads are indexed and bounded at 10 per job, so this is a storage question, not a speed one. Revisit in v2.
- The other forms (password, delivery mode, setup) still reset on submit. Correct for a password field, harmless for the others, so they were left alone rather than widened past M1.
- `/settings` ships 28.7 kB of route JS, most of it the ~600-entry time zone list. Measured and accepted; a datalist would cut it if it ever matters.

**Gate: passed.** `npm run check` green (typecheck, 55 tests, production build). `npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory already in the README; no new findings. Exercised against `next dev` on the embedded database: setup, protected time rejected then saved then removed, time zone saved and re-rendered, export downloaded with no secret fields, and the cron route refused four ways before running the registry and recording it in Settings. Settings has no horizontal overflow at 375 px.
