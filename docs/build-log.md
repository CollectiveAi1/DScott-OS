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

## 2026-11-02 · M3 · Schedule

Branch `m3-schedule`, off `main` (M1 and M2 are merged). Spec `docs/specs/SPEC-003-schedule.md`,
plan `docs/plans/PLAN-003-schedule.md`.

**Shipped**

- `src/lib/zoned.ts`: wall time ↔ instant, and day, week and month grids, all in a named zone.
- `src/modules/schedule/`: the conflict rule, arena-driven kinds, queries, service, actions,
  form schema, and the view components.
- `/schedule` with Agenda, Week, Day and Month; `/schedule/new` and `/schedule/<id>`.
- Conflicts on both events and on Command for the next 14 days, with Acknowledge.
- Protected time hatched behind Week and Day.
- Migration `0003_schedule`: `conflict_acks`, unique on the ordered pair, both FKs indexed.
- "Make event" in the Misc inbox is a real link now, prefilled, and completes the capture.

**Decided at this gate**

- **Half-open intervals, `[start, end)`, everywhere.** Back-to-back scheduling is the normal
  case, not a conflict. Every comparison in the module follows it.
- **All-day is midnight to exclusive midnight.** Nov 5–7 stores as Nov 5 00:00 → Nov 8 00:00.
  This is deliberately Google's `start.date`/`end.date` shape so M4's mapping is a copy rather
  than a conversion, and M5's importer has one rule to follow. Written into the README as a
  contract, not left implicit.
- **One file converts between instants and wall time.** `zoned.ts` is the only place that knows
  how; everything else asks it. Two passes over the zone offset settles DST.
- **Both DST ambiguities have a stated answer.** A wall time inside the spring-forward gap
  resolves to the instant the clock jumps to; a time that happens twice in autumn resolves to the
  first. Picking a side consistently matters more than which side, and both are tested.
- **Agenda and Week are both rendered when no view is chosen**, with CSS picking by width. That
  is the PRD's per-device default with no server-side viewport guess, no JS and no flash.
- **Rule 3 is basketball only.** A practice inside a team event is normal; two Collective
  meetings double-booked is exactly what Devon wants caught.
- **Protected-time clashes cannot be acknowledged.** The ack table keys on two event ids, and a
  block is a settings rule. The honest fix is to move the event or change the block.
- **The grid is a full 24 hours**, scrolled to 07:00 on open. Practices and travel do not sit
  inside 9–5, and a grid that hides half the day hides conflicts.

**Open question for Devon at the M4 gate**

Rule 5, taken literally as PRD §8.3 states it, makes **any** all-day event conflict with every
timed event it covers — not just travel. It ships that way. But M4 syncs the Family calendar out
of Gmail, where all-day entries are the common case (birthdays, holidays, school closures), and
on the first sync one all-day row will clash with every timed event that day. A conflict has to
mean something or the panel stops being read.

The fix is one condition in `eventsConflict` (`rule 5 applies when the all-day side is travel`).
It is not being decided here: the call wants real synced data in front of it. **Raise this at the
M4 gate.**

**Found while building**

- **A zod message reached the screen**: "Invalid input: expected nonoptional, received
  undefined", in front of Devon, which §6.1 forbids. Two causes behind it — an unchecked
  checkbox and a hidden time input send *no field at all*, not an empty one. Form parsing moved
  into `form-schema.ts` with its own tests, one of which asserts no raw zod wording can escape
  for any missing field.
- **The React form-reset trap, for the third time.** M1 hit it on a text field, M2 on checkboxes
  and a select, M3 on the event form's arena and kind selects — and this one was the worst of the
  three: after a refusal the selects reverted while React's tree still held the chosen values, so
  the *next* submit would have posted the wrong arena. The rule, now proven enough to state once
  and apply everywhere: **any control React cannot diff back into place — checkbox, radio,
  select — must be remounted when a form action settles; text inputs re-apply on their own.**
- A test of mine was wrong rather than the code: a practice starting exactly when a meeting ended
  was expected to clash. Half-open intervals say otherwise, and they are right.

**Deferred**

- Drag to move or resize an event. Editing is a form, as everywhere else in v1.
- Recurring events. Nothing in v1 creates one: Google expands instances, the importer writes
  rows, and protected time is a settings rule.
- Overlap-aware layout in Month. Cells list events; Week and Day are where overlap is read.

**Gate: passed.** `npm run check` green (typecheck, 192 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory. Exercised
against `next dev`: the PRD's own example — a Collective meeting against a game — appeared on
Command with both titles and times, acknowledging hid it, and editing the meeting's time brought
it back with the new times. Travel auto-selected all-day and stored Nov 6 → Nov 9 exclusive.
Month rendered 42 cells opening on 2026-10-26. Arena-driven kinds switched with the arena. A
refused submit held every field. Capture → Make event → prefilled form → capture completed. At
375 px: Agenda replaces Week, and the wide grids scroll inside themselves while the page does not.

## 2026-11-03 · M4 · Family sync (Google Calendar, read-only)

Branch `m4-google-sync`, off `main`. Spec `docs/specs/SPEC-004-google-sync.md`, plan
`docs/plans/PLAN-004-google-sync.md`.

**Shipped**

- `src/modules/google/`: signed OAuth state, the pure event mapping, the HTTP client, token
  storage and refresh, the sync algorithm, the service, actions and the Settings panel.
- `/api/google/start` and `/api/google/callback`.
- The real `google-sync` job body, replacing M1's stub. "Sync now" in Settings.
- Broken connections surface in Settings and in Command → Needs attention.
- Migration `0004_google`: `calendar_events.external_url`; `CalendarSource` widened to carry
  `summary`, `lastSyncedAt` and `lastError`.
- **The conflict rule, narrowed** — the question M3 flagged, now answered.

**Decided at this gate**

- **All-day events only conflict when they are Travel.** Devon's call. The rule as PRD §8.3
  states it would have made every synced birthday and holiday clash with that day's meetings,
  and a conflict has to mean something or the panel stops being read. The accepted cost: an
  all-day Collective deadline no longer flags against meetings, which is defensible — a deadline
  does not occupy hours. One condition in `eventsConflict`; SPEC-003 §3 annotated as resolved.
- **The sync takes its API as an argument.** Every one of the 18 sync tests drives a fake built
  from recorded fixtures; nothing in the test suite knows Google's hostname. This is also what
  made the whole module provable before any credentials existed.
- **A partial read never deletes.** Deletion only runs after every page of a calendar has been
  read. Deleting on incomplete data would silently empty Devon's calendar, which is the worst
  thing this module could do, and there is a test for each half of it.
- **`description` is never imported.** `notes` is the one field Devon can edit on a synced row,
  and a sync that rewrote it every ten minutes would make it useless. The description stays one
  click away through `externalUrl`.
- **`invalid_grant` is terminal; everything else is transient.** A revoked grant marks the
  connection broken and stops the job. Any other failure is recorded on the source and retried
  next tick.
- **Polling, not webhooks, and no `syncToken`.** Push needs channel renewal and a recovery path;
  an incremental token is a cache that can go stale invisibly. Re-reading a 127-day window is
  idempotent by construction and cheap.
- **Unticking a calendar takes its events with it**, as does disconnecting. A calendar that is
  no longer a source should not leave rows behind.

**Found while building**

- **A broken connection could only be reconnected, never removed.** That leaves the synced
  events with no way to clear them short of reconnecting to an account Devon may have cut off on
  purpose. Both buttons are there now.
- **The M1 cron test was still asserting a stub's text.** It now asserts the real reason the job
  skipped ("No calendars are feeding Family yet."), which is a better message than the milestone
  tag it replaced.
- The OAuth pieces cannot be exercised in a browser without a real Google account, so the parts
  that carry the security — the consent URL and the callback's state handling — got their own
  tests instead. Twelve of them.

**Deferred**

- Write-back to Google. v2, through Approvals.
- Calendars feeding an arena other than Family. The source record already carries an arena so
  v2 can widen it without a migration; v1 only ever writes `family`.

**Still needs Devon**

Nothing in the code is waiting, but the connection cannot be made until there is a Google Cloud
OAuth client: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a redirect URI of
`${APP_URL}/api/google/callback`. **Publish the app** — a client left in Testing issues refresh
tokens that expire after seven days. The README has the steps, and Settings → Connections prints
the exact redirect URI to paste.

**Gate: passed.** `npm run check` green (typecheck, 242 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory. Exercised
against `next dev` with no real Google account: the panel's not-configured state prints the exact
variables and redirect URI; the not-connected state offers Connect; a broken connection shows
Reconnect in Settings and in Command → Needs attention, and the cron tick still returned 200 and
still ran the jobs after it; Disconnect armed, confirmed, cleared the connection and the warning.
An all-day family birthday placed against the existing meeting-and-game clash added no new
conflicts, which is the narrowed rule doing its job.

## 2026-11-03 · M5 · Basketball schedule import

Branch `m5-schedule-import`, off `main`. Spec `docs/specs/SPEC-005-schedule-import.md`, plan
`docs/plans/PLAN-005-schedule-import.md`.

**Shipped**

- `src/modules/import/`: an RFC 4180 CSV reader, the row rules, content-derived identity, the
  diff, the model path, the service and the screen.
- `/schedule/import`, linked from Schedule. `docs/samples/basketball-schedule.csv`.
- Migration `0005_import`: `calendar_events.import_batch`, indexed with `source`.
- `@anthropic-ai/sdk` added — named in PRD §6, so in-stack rather than a new vendor.

**Decided at this gate**

- **Preview, then write. Never both at once.** Every path through this module ends at a preview
  Devon confirms. Confirm re-parses the same source rather than trusting a round-tripped plan:
  the parser is deterministic, so what he approved is what runs, and there is no half-built
  import sitting in a table going stale.
- **Identity is content**, exactly the hash PRD §8.5 specifies, with the title normalised for
  case and spacing. Two exports of one schedule differ in whitespace far more often than in
  substance, and an importer that duplicated a season over a double space would be useless.
- **A time edit is a move, not a delete and an add.** The time is part of the hash, so a moved
  practice gets a new id. When exactly one dropped row shares its date, type and title, the two
  are paired and the existing row is updated in place — keeping its id, its notes and any
  acknowledged conflict. Ambiguous cases fall back to add-and-remove rather than guessing.
- **Removal is future-only and confirm-only.** A past game dropped from a revised schedule
  stays. It happened; the record is worth more than a tidy table.
- **One row interpreter for CSV and the model.** The spec promised "the model is a parser, not a
  second code path"; extracting `interpretRow` is what made that true. Same defaults, same
  types, same error text, whichever way the schedule arrived.
- **The document is data, not instructions.** Said in the prompt, enforced by giving the model
  no tools, and backstopped by the preview: the worst a hostile PDF achieves is rows Devon
  declines.
- **An assumed end time is shown as an assumption**, in its own group, on the rows that made it.

**Found while building**

- **Notes would have been overwritten on every re-import.** The CSV carries a notes column, but
  `notes` is also the one field Devon can edit on an imported event (M3) — the same trap M4
  dodged with Google's `description`. Notes are written on create and left alone thereafter.
- **"A re-import is a no-op" was nearly a near-truth.** Unchanged rows were going to get a fresh
  batch id and a bumped `updated_at`. They are now not touched at all, and a test asserts the
  timestamps are identical across two imports.
- A PDF posted through a server action hits Next's 1 MB default body limit. Raised to 8 MB, with
  the importer refusing anything larger itself and naming the actual size.
- Two of my own tests were wrong rather than the code: a title differing only in spacing really
  is a change worth showing, and a practice starting exactly when a meeting ends really does not
  overlap.

**A correction to the PRD**

§6 names `claude-sonnet-5-5` and `claude-haiku-5-5`. **Neither model id exists.** The code uses
`claude-sonnet-5`, overridable with `OPERATOR_MODEL`. Recorded in the spec and the README, and
worth fixing in the PRD before M9 builds the Operator on top of it.

**Deferred**

- Editing rows inside the preview. A wrong row is fixed in the source and re-previewed; an
  editable preview is a spreadsheet, and Devon already has one.
- Importing into any arena but Basketball. Enforced in the service, not the UI, so it cannot be
  widened by accident.

**Gate: passed.** `npm run check` green (typecheck, 317 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory; the new
dependency adds none. Exercised against `next dev` with the sample file: 7 rows previewed with
2 assumptions flagged and nothing written; confirmed as 7 added; re-previewing the same file
reported 7 unchanged and did not even offer a Confirm button; editing one practice's time
previewed as "1 changed · moved" and wrote 1 update with the row keeping its id; a file with a
broken line, a dropped game and a new game previewed as 1 new, 2 to remove, 1 error on line 4
with the reason, and confirmed exactly that. Imported events render on the week grid beside
manual ones and open read-only apart from notes. No horizontal overflow at 375 px.

## 2026-11-03 · M6 · Contacts + Pipelines

Branch `m6-contacts-pipelines`, off `main`. Spec `docs/specs/SPEC-006-contacts-pipelines.md`,
plan `docs/plans/PLAN-006-contacts-pipelines.md`.

**Shipped**

- `src/modules/crm/`: money, business days, the next-step rule, the two handoffs, queries,
  service, actions and the screens.
- `/contacts` with search and type filters; the contact page with a merged, cursor-paginated
  timeline and the three log buttons; `/pipelines` with next-step discipline and stage moves;
  Settings → Pipelines.
- Migration `0006_crm`: `pipelines.billing_stages`, `tasks.handoff_key` (unique), and a
  `(contact_id, created_at desc)` index on timeline.
- `src/lib/form-fields.ts`: the shared optional-field helpers (see below).
- The task drawer's contact and deal pickers, which M2 shipped as placeholders.

**Decided at this gate**

- **Exactly-once is a unique index, not a convention.** `handoff_key` carries
  `invoice:<dealId>:<stage>` or `onboard:<contactId>` and the insert is `on conflict do nothing`.
  Inferring "has this already fired" from task titles or timeline history would break the first
  time a deal was renamed.
- **The guarantee is no duplicates while the task exists.** The spec first claimed a deleted
  handoff would never return; it cannot, because deleting the task deletes its key. The honest
  rule is also the more useful one — a handoff deleted by mistake can come back.
- **The timeline merges in the application, not in SQL.** Three sources, each indexed and
  over-fetched to the page size, so one chatty source cannot crowd the others off a page. A test
  walks 25 rows across three pages asserting no repeats and no gaps.
- **Do-not-contact is enforced in the service.** The Operator does not use forms, so a check in
  the UI would be theatre. `assertContactable` ships tested now, ahead of anything that can draft.
- **A rename moves the deals standing in the stage** and is refused outright if the stage is
  being removed with deals still in it, naming how many. Losing a deal to a dropdown edit is not
  an acceptable failure mode.
- **Money is refused, never rounded.** `$1,250` and `1,250.50` work; anything unreadable gets a
  message. A deal value quietly coerced into something plausible is worse than one that will not
  save.

**Found while building**

- **The same form bug, a third time — so it is now one file.** A browser posts *no key at all*
  for a control it did not render or a box nobody ticked. M3's all-day checkbox, M3's hidden
  time inputs, and now M6's log form, which showed Devon "Check the form." for a `dealId` that
  was never on screen. Each module had its own near-identical helpers; they are now
  `src/lib/form-fields.ts`, tested, and used by Work, Schedule and CRM alike.
  **Rule: an optional form field must treat absent and empty as the same thing.**
- **The seed could not reach existing rows.** `billingStages` arrived in this milestone, so every
  pipeline seeded by an earlier one carried an empty array — silently meaning "no billing handoff
  will ever fire". `onConflictDoNothing` would never have fixed them. The seed now backfills the
  starter values *only where nothing is configured*, so an existing install is repaired and
  Devon's own edits survive. **This is a standing hazard of an idempotent seed: check it at every
  milestone that adds a column with starter data.**
- **Renaming a billing stage turned billing off.** The Settings form posts what was ticked before
  the edit, so the old name no longer matched a stage and was filtered away. The rename map now
  applies to the billing flags too — the same silent loss as orphaning deals, one level up.
- A reminder about the local database: `npm run db:seed` while `next dev` holds the PGlite lock
  appears to succeed and writes nowhere the app can see. Stop the server first.

**Deferred**

- Sending anything. Handoffs are tasks inside the OS; messages are M8's, through Approvals.
- Importing contacts. PRD §12's default is to start clean.
- Orgs as their own screen. An org is a field on a contact that creates one if the name is new.

**Gate: passed.** `npm run check` green (typecheck, 397 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory. Exercised
against `next dev`: a contact created and logged against; making them a Client raised exactly one
Kenza task; a deal typed as `$1,250` stored 125000; moving it to Deposit, out to Building and
back to Deposit produced exactly one Ahmad task and three recorded stage moves; Command's "Deals
moved · 7 days" read 3; the board showed the red edge and "No next step"; removing a populated
stage was refused with "1 deal still stands in \"Deposit\""; renaming it moved the deal with it.
No horizontal overflow at 375 px on either screen.

## 2026-11-04 · M7 · Learning

Branch `m7-learning`, off `main`. Spec `docs/specs/SPEC-007-learning.md`, plan
`docs/plans/PLAN-007-learning.md`.

**Shipped**

- `src/modules/learning/`: the review as pure data, a deterministic offline template, the model
  rewrite over an injected client, queries, service, actions and the screens.
- `/learning` with the review on top and the skills list; the skill page with quick-log, items
  and the practice log.
- The real `learning-review` job body, replacing M1's stub, plus **Write it now**.
- Migration `0007_learning`: `digests`, unique on `(kind, day)`, with `source` and `data`.
- The latest review on Command.

**Decided at this gate**

- **The review is data before it is prose.** `buildReview` takes rows and a date and returns a
  structure; the template, the model prompt and the screen all read that one thing. There is one
  place a number can be wrong.
- **The numbers are never the model's.** Every figure is computed and interpolated; the model is
  handed them already resolved and told plainly not to calculate. A weekly review that quietly
  reported the wrong total would be worse than a plain one — and the plain one always exists.
- **Offline is the floor, not the fallback.** No key, an API failure, or a reply too short to be
  worth keeping all store the deterministic text, and the digest records which wrote it.
- **One next step per skill**, down a six-rung ladder. A review handing back six things is a
  backlog, and the rest of the OS is already that.
- **Practice is additive.** Two sessions on one day are two rows; the day's total is their sum.
  An overwrite would quietly lose the morning's work.
- **A digest is a record, not a view.** The text is stored as it read that Sunday. Recomputing it
  later would rewrite history — the same reasoning that keeps past events out of M5's import
  removals.
- **`digests.data` alongside the body**, so a later milestone can chart or re-render a review
  without re-deriving it. `daily_brief` is in the enum already, so M9 adds no migration.

**Found while building**

- **A second wrong model id in the PRD.** M5 found `claude-sonnet-5-5` does not exist; neither
  does `claude-haiku-5-5`, which §6 names for `SUMMARY_MODEL`. The code uses
  `claude-haiku-4-5-20251001`. Both corrections are in the README. **The PRD itself is still
  wrong — fix it before M9 builds the Operator on those lines.**
- **The job handler needed its own test.** Everything under it was covered, but the registered
  definition — the wiring that actually runs on a Sunday — was not. It now goes through `runJob`
  with a Sunday-evening clock, and the schedule is asserted due only after 18:00 on a Sunday.
  Worth repeating for M8's deliverer and M9's brief.

**Added beyond §8.7**

- **Write it now.** The job runs once a week; a feature nobody can see until Sunday is a feature
  nobody trusts. Same reasoning as M4's "Sync now".

**Deferred**

- Importing from a course platform. There is nothing to import from, and the point is the record
  Devon keeps.
- Reminders. The weekly review is the nudge; more becomes noise he turns off.

**Gate: passed.** `npm run check` green (typecheck, 449 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory. Exercised
against `next dev`: a skill created, **+30m today took the 7-day total from 0m to 30m on the
spot**, a second +15m made it 45m across two rows rather than replacing the first, an item added
with its link, and the review written on demand — "You logged 45m this week, up 45m on last
week", next step "Keep going on \"Effective TypeScript\"". Writing it twice left one digest row.
Command shows the review and links through. The cron tick reported `learning-review` as not due
on a Wednesday, which is right. No horizontal overflow at 375 px on either screen.

## 2026-11-04 · M8 · Approvals engine

Branch `m8-approvals`, off `main`. Spec `docs/specs/SPEC-008-approvals.md`, plan
`docs/plans/PLAN-008-approvals.md`.

**Shipped**

- `src/modules/approvals/`: the state machine, payload schemas per kind, the provider interface
  and its no-op, the service, queries, actions and the screen.
- `/approvals` with Waiting · Scheduled · Failed · History.
- The real `approvals-deliver` job body, replacing M1's stub.
- Going live refused while no provider can deliver.
- Migration `0008_approvals`: `approval_status` gains `sending`.

**Decided at this gate**

- **The dangerous thing is structurally hard, not merely discouraged.** One function expresses
  an outbound action, one pure machine decides what may follow, and in v1 no provider exists
  that could send. Each of those is a separate thing that would have to fail.
- **Sandbox is a branch, not a flag.** A sandbox approval reaches `sent` at the moment of
  approval and the delivery job only ever looks at `scheduled` rows, so there is no path from
  sandbox to a provider to accidentally take. A spy provider asserts zero calls rather than
  trusting the reading.
- **The delivery mode is read from settings, never from the form.** A posted `mode=live` must
  not be able to assert its way past sandbox. In the one module whose job is refusing to send,
  the value that decides whether something sends cannot come from the request.
- **`NoopProvider` is the guarantee, not a placeholder.** PRD §7 puts "no automatic outbound
  send" in WON'T HAVE for this release; this is that sentence written as code. A test asserts
  `hasRealProvider()` is false, so if it ever flips by accident the suite says so first.
- **Claiming is one atomic `UPDATE … RETURNING`.** The database decides who gets a row, so two
  overlapping ticks cannot both deliver it. Tested with two concurrent claims.
- **A failed row goes back to Devon, not back to the queue.** Automatic retry of an outbound
  message is how one send becomes three.
- **Added beyond §8.8's table: `scheduled → rejected`.** Approving is not the last moment Devon
  may change his mind; without it, an approved-but-unsent message could not be stopped, which is
  the opposite of what this module is for. A claimed row is past recall and stays uncancellable.
- **Enter saves, never approves.** The decision buttons live outside the editable form. Verified
  in a browser with a real keypress, not only by reading the markup.
- **The job records v1's failures as failures.** With nothing connected every delivery fails, so
  the run is `error` with the reason. Reporting it as `ok` would make the job history useless
  exactly when it matters. "Nothing due" stays `skipped`.

**Found while building**

- **The M1 cron test needed retiring again.** It asserted `approvals-deliver` reported "Ships in
  M8." — the second milestone to hit that (M4 was the first). One stub assertion remains,
  `daily-brief`, which M9 replaces. Worth expecting rather than rediscovering.
- `editApproval` cannot go through the generic `apply`, because an edit changes the payload and
  leaves the status alone. It still asks the machine whether an edit is allowed, then
  compare-and-sets on `status = 'waiting'`, so a draft edited at the same moment it is approved
  cannot overwrite the approved version.

**Deferred**

- Resend and Twilio. v2, and the PRD gates going live on one of them existing.
- Provider retries and scheduling beyond "now or a chosen time".

**Gate: passed.** `npm run check` green (typecheck, 520 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory. Exercised
against `next dev`: three drafts in Waiting across all three kinds; **Enter in the subject field
saved the edit and left it waiting**; approving in sandbox moved it to History as sent/sandbox
and wrote "Sandbox: would have sent …" to the contact's timeline; the Command tile read 2 and so
did the Waiting tab; typing LIVE in Settings was refused with "No email or text provider is
connected…" and the mode stayed sandbox; a scheduled text was claimed by the cron tick, failed
with "No text provider connected.", landed in Failed with that reason and a recorded `error`
run, and **Back to Waiting** returned it clean. No horizontal overflow at 375 px.

## 2026-11-04 · M9 · Operator + daily brief

Spec `docs/specs/SPEC-009-operator.md`, plan `docs/plans/PLAN-009-operator.md`, branch
`m9-operator`.

**The decision this milestone turns on**

M9 is the first time a model acts on Devon's data rather than reading a document he handed it.
Every title, note, location and contact detail it reads was written by somebody else, and a
model that can be instructed by its input has to be assumed to be instructed by its input
sometimes. So the question was not "will the prompt hold" but **what is the worst thing a
successfully injected Operator can do** — and the answer had to be small enough to live with.

It can write a task, a note, a practice row, an event, a stage move, or a draft that sits in
Approvals. Nothing leaves the instance, nothing is deleted, no setting changes, and no message
reaches a person without Devon pressing approve. M8 was built one milestone early for exactly
this; M9 is where it becomes load-bearing.

**Decisions**

- **The tool registry is the boundary, not the system prompt.** Each tool declares
  `effect: "read" | "write"`, and a test pins both the full set of 18 and the subset of 8 that
  write. A new tool that writes fails the suite until someone edits that list on purpose. The
  prompt is a quality instrument; it holds when things work, and the tool set holds when they
  do not.
- **No tool reads settings.** The time zone and the protected blocks are resolved once at the
  action layer and handed down in `ToolContext`. That is both the testable shape and the honest
  one — a settings read inside the module whose boundary is "no tool touches settings" was the
  wrong place for it.
- **`messages.draft` reaches exactly one function:** M8's `createApproval`. Its idempotency key
  is a hash of what is being said to whom, so a retried tool call returns the draft that already
  exists rather than writing a second one. Its output says `sent: false` in so many words.
- **Pure first, again.** The free-slot finder and the brief were written and tested before the
  loop existed, so by the time a model was involved everything it could reach was already
  covered. `freeSlots` is pure instant arithmetic — no minutes-into-a-day — so a 23- or 25-hour
  day needs no special case and a returned time is always one that exists.
- **The brief falls back to the template on anything.** No key, an error, or a reply too short
  to be a brief, and the deterministic version is what gets stored. A brief that only works when
  an API key does is not a brief you can plan a morning around.
- **Deterministic thread titles.** From the first message, cut at a word. A title is not worth
  an API call and a deterministic one cannot surprise.
- **Usage is logged, not capped.** A cap that refuses mid-turn is worse than a visible number
  for a single-owner instance. Settings shows the 30-day total.
- **`daily-brief` was the last of M1's four stubs.** The registry has none left.

**Found while building**

- **A claim in the spec was wrong and was withdrawn.** §4 said writes inside one tool call are
  transactional (PRD §6.3). They are not — M6's `moveDeal` already writes the stage move and the
  handoff task in sequence. What is true is narrower: each tool makes at most one logical write
  through an existing tested service, and those services carry their own idempotency. Claiming
  atomicity the code does not have is worse than the gap.
- **`schedule.range` silently truncated an over-long window**, so a twelve-month question came
  back with January's events under a twelve-month heading. A wrong answer dressed as a complete
  one. Now refused, with a message the model can act on.
- **The brief wrote conflict times as ISO instants** — "…· 2026-11-04T23:15:00.000Z" for a clash
  at 18:15. Both the wrong number and the wrong language, found in the browser pass, now local
  wall time with a regression test.
- **Earlier tool calls cannot be replayed to the API as blocks.** A `tool_use` whose
  `tool_result` has fallen outside the 30-message window is an API error. Prior turns go back as
  the conversation plus a line naming which tools ran; the full record stays on the thread.
- **The Anthropic client was extracted** to `src/lib/model.ts`. M9 would have been the third copy
  of the same constructor.
- **PRD §6 still names two model ids that do not exist** (`claude-sonnet-5-5`,
  `claude-haiku-5-5`). Flagged since M5; now worked around in one place instead of three.

**Deferred**

- Streaming replies. A slower, legible turn beats a half-rendered decision.
- Voice, MCP servers and Conductor loops — v3.
- A spend cap, which wants real usage behind it.

**Gate: passed.** `npm run check` green (typecheck, 632 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory. Exercised
against `next dev` with threads seeded through the real service and a scripted client: the
thread renders with its tool calls collapsed and **the `messages.draft` summary carries no
message body**; the Operator's draft landed in Approvals as waiting, attributed to the Operator;
a call to a tool that does not exist came back ERROR with nothing changed; today's brief renders
on Command and **Regenerate replaced it in place** rather than writing a second; Settings reports
3 turns and 11,040 input tokens; with no key `/operator` shows "Add ANTHROPIC_API_KEY…" and the
brief still writes. **Enter sends and Shift+Enter does not** — verified with a dispatched
KeyboardEvent, because this environment's key injection delivers `key: ""`; the handler was not
loosened to accommodate that. With a deliberately bad key the failure path ran for real: the
error showed, the composer kept its text, and the thread was left with the user's message and no
assistant row. No horizontal overflow at 375 px with every tool call expanded.

## 2026-11-10 · M10 · Command complete + deploy

Spec `docs/specs/SPEC-010-command-deploy.md`, plan `docs/plans/PLAN-010-command-deploy.md`,
branch `m10-command-deploy`. **This completes v1.**

Nothing new was invented here. Every module already worked; M10 was about the two places where
that stopped being true for Devon — the screen he opens first, and the machine it runs on.

**Decided with Devon at DEFINE**

- **Vercel Hobby, one cron a day**, `0 11 * * *`. Hobby allows no more, and the same config is
  correct on Pro, so the plan can change later without a code change.

**The bug this milestone existed to find**

`0 11 * * *` is **06:00 in New York in winter** and 07:00 in summer. The morning brief's window
was "after 06:30" — so on the deploy as configured, **the brief would have been written all
summer and silently stopped every November**. Nothing would have errored; there would simply
have been no brief, and the only clue would have been the season.

The window was widened to 05:00 rather than the cron moved later, because 12:00 UTC would put
the brief at 07:00 and 08:00 — later than Devon wants to read it. Tested at both offsets, and
`vercel.json` is asserted by a test so the two cannot drift apart.

This is the kind of thing a deploy milestone is for. It is not findable by reading the code and
it is not findable in July.

**Decisions**

- **Command's order is the argument.** Tiles are the glance, the brief is the read, conflicts
  and needs attention are what will cost something if unseen — so they sit above the two lists
  rather than under them. Reference goes last.
- **The brief is a `<details>`** with its state in the URL (`?brief=closed`), like every other
  piece of state since M2. No JavaScript, survives a reload, and a link can carry either.
- **Needs attention gained its last three sources** — failed approvals, jobs that errored in the
  last 24 h, and deals with no or an overdue next step. Ordered by **what it costs to ignore**,
  not by which module noticed. Every row says what clears it; the panel hides when empty, since
  one that is always on screen stops being read.
- **One row per failed job, not per run.** `approvals-deliver` fails every tick while no
  provider is connected, and twelve identical rows would bury the other four sources.
- **One row per stalled deal, not a count.** The next-step discipline is per deal, and a count
  is not something you can act on.
- **A next step with no date is not overdue.** Undated is Devon's call; inventing a deadline
  would be the OS enforcing a rule nobody set.
- **Run now ignores the schedule.** On a once-a-day cron, a button that respects the due check
  would do nothing for the rest of the day — which is the one moment it is wanted. It still goes
  through `runJob`, so a manual run is recorded exactly like a scheduled one.
- **The weekly review sits after today's schedule**, outside PRD §8.10's list of eight. It did
  not exist when §8.10 was written, and a once-a-week read does not belong among the daily ones.

**The runbook**

`docs/runbook.md`, written for someone at 7am with something broken rather than for a developer
reading in order: every environment variable and what breaks without it, how to rotate each
secret and what it signs out, what the export does and does not carry, every Needs-attention row
and what clears it, the three failures that have actually happened, and a first-deploy checklist.
It also says plainly **what is normal and not worth chasing** — `approvals-deliver` erroring
with no provider, `google-sync` skipping with no calendars picked, the Operator closed with no
key.

**Deferred**

- The deploy itself. It needs Devon's Supabase and Vercel accounts; runbook §7 is the handoff.
- Everything in v2. A week of real use is the input to deciding what v2 is — guessing now would
  waste the week.

**Gate: passed.** `npm run check` green (typecheck, 663 tests, production build).
`npm audit --omit=dev` reports only the pre-existing PostCSS-inside-Next advisory. Exercised
against `next dev`: Command renders the eight sections in order; **Needs attention showed all
five sources** — two failed approvals, one failed job, two stale captures and a deal with no
next step — while a job failure from 30 hours ago was correctly absent, and the Conflicts section
hid itself on a day with no clashes; the brief collapsed and `?brief=closed` survived a reload;
**Run now on `daily-brief` ran twice in one day**, both recorded, the second with its window
already used; `/api/health` returns ok. No horizontal overflow at 375 px on Command or Settings.

**Gate to v2: a week of Devon's actual life, in sandbox, with real data.** What broke, what he
changed, and — most usefully — what he never opened.
