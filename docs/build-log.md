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

## 2026-11-02 · M2 · Work + Misc capture

Branch `m2-work`, stacked on `m1-foundations` (M1 is not merged yet, and M2 depends on it).
Spec `docs/specs/SPEC-002-work.md`, plan `docs/plans/PLAN-002-work.md`.

**Shipped**

- `src/modules/work/`: `capture.ts` (pure parser), `filters.ts` (pure, URL in → typed filters out),
  `queries.ts`, `service.ts`, `actions.ts`, components. This is the module shape every later
  milestone copies.
- Quick capture on Command and in a bar fixed to the bottom of the screen on phones.
- `/work`: Misc inbox with triage, board view, list view, four composable filters, Move to…,
  Complete, and a task drawer at `?task=<id>`.
- `/work/projects`: create, status, done/total over linked tasks.
- Command: quick capture, Needs attention, and a due list that links into the drawer.
- Arena colour tokens and `<ArenaTag>`; sidebar collapses to a menu button under `md`.
- Migration `0002_work`: `tasks.notes`, `boards.position`, two indexes.

**Decided at this gate**

- **The whole Work screen is URL state.** View, board, filters and the open drawer are query
  parameters, so every view is a plain server render: shareable, refresh-proof, back-button
  correct, and working without JS. The cost is a round trip per filter change, which is the
  right trade on a single-owner instance.
- **A weekday means its next occurrence including today.** `due:mon` typed on a Monday is today,
  so it agrees with `due:today` instead of quietly meaning eight days out.
- **Anything the parser does not recognise stays in the title.** `#kinetic` and `due:whenever`
  survive into the text. A capture that silently dropped a word would be worse than one that
  shows it did not understand, and quick capture must never lose the thought.
- **Tagging is not triage.** A capture tagged `#basketball` still lands in the Misc inbox: the
  tag says where it belongs, sorting says it is sorted.
- **Completing clears `fromMisc`.** A capture you finish is triaged by finishing it.
- **A column is only valid if the board has it**, checked in the service, so a forged POST cannot
  invent a column. Choosing no board drops the column rather than orphaning it.
- **Deleting takes two presses** instead of a modal. A dialog needs client state and a focus trap
  to be accessible; an arming button needs neither.
- **"Make event" ships disabled with its reason** rather than hidden, following the PRD's own
  pattern for model parsing without a key (§8.5). M3 fills it in.
- **Unsorted comes first on a board.** A task whose column is missing or no longer on the board
  is grouped at the front, so nothing a board holds is invisible.

**Found while building**

- **The due tile and the due list disagreed.** The list excluded untriaged captures, the tile
  never did, so Command read "3" above a list of 2. The tile was right: a capture with a date is
  due whether or not it has been filed onto a board. The list now includes them and a test
  asserts the two reconcile.
- **Work opened on an empty board.** Boards sorted by name put "Collective AI" first while the
  day's tasks sat on "This week". Ordering by `created_at` did not help — the seed writes all
  four in one statement, so they share a timestamp and the tie falls back to the alphabet. Added
  `boards.position`, set by the seed. Spec updated (§11) rather than left in the diff.
- **The filter form had two fields named `board`**, a hidden one and the visible picker. Caught
  reading the diff before the browser pass; the hidden one now renders only when the picker does.
- **M1's React 19 warning paid off.** Every multi-field form here — capture, triage, drawer,
  project create, the status select — was built controlled or keyed from the start. Nothing lost
  input on a refusal, and nothing needed fixing afterwards. That warning is the most valuable
  line the build log has produced so far; keep writing them.

**Deferred**

- Drag and drop between columns. The PRD calls it optional sugar; "Move to…" is keyboard-first
  and shipped instead.
- Contact and deal pickers on a task. M6 creates the first of either; the drawer shows the slots
  and says which milestone fills them.
- The board picker does not remember the last board between visits. It is in the URL, so a
  bookmark holds it; a stored preference can wait for a reason to exist.

**Gate: passed.** `npm run check` green (typecheck, 120 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory; no new
findings. Exercised against `next dev` on the embedded database: the PRD's own capture line
parsed exactly as §8.2 specifies, `due:fri` and `due:mon` resolved correctly, triage onto a board,
Move (which omits the current column), drawer edit with notes, every filter and combination,
complete leaving Command's due list, two-step delete, project create and its count moving to 0/1.
At 375 px: no horizontal overflow, the nav collapses behind a menu button, and the capture bar
captured `Order team warmups #basketball due:mon` from the bottom of the screen.
