# DScott OS

Devon Scott's operating system: one home base for Collective AI, basketball, family and everything else. Built from Blueprint v0.1. It is also the pilot for the OS-building process: decisions made here are logged so the next OS starts from them.

## Status: M8 shipped (Approvals engine)

| Done | Not yet |
| --- | --- |
| Owner account (`/setup`, `/login`), signed 30-day session, sign-out | Learning, Contacts, Pipelines, Approvals, Operator (M6–M9) |
| Quick capture with `#arena`, `!priority` and `due:` tokens, on Command and the phone bar | The Operator and the daily brief (M9) |
| Work: Misc inbox, board and list views, filters, move, complete, task drawer, projects | Vercel project + Supabase database (needs a Supabase project) |
| Schedule: Agenda, Week, Day and Month views, manual events, conflicts, protected time | Approvals delivery, the daily brief and the weekly review (M7–M9) |
| Google Calendar read into Family: OAuth, calendar picker, 10-minute sync, Reconnect | Shared rate limit store (current limit is per instance) |
| Schedule import: CSV, or a PDF/image through the Operator, previewed before anything saves | Approvals delivery (M8) and the Operator (M9) |
| Contacts with a merged timeline, pipelines with next-step discipline, handoff tasks | The final Command and the deploy (M10) |
| Learning: skills, practice log, and a weekly review written every Sunday | Email and text providers — v2, and going live is blocked until one exists |
| Approvals: the gate every outbound action passes through | The official team schedule itself, which has not arrived |
| Command: capture, live tiles, due this week, Conflicts, Needs attention | |
| Settings: delivery mode, time zone, protected time, connections, export, job history | |
| Encryption for stored keys, job runner, `/api/cron/tick` | |
| Schema for all v1 tables, tracked migrations, idempotent seed | |

## Schedule

Four arenas on one calendar. Agenda on phones, Week on desktop, plus Day and Month; every view
is a URL, so any of them can be bookmarked or shared.

**How events are stored** — the contract the Google sync and the schedule importer write against:

- `starts_at` and `ends_at` are instants (`timestamptz`). The wall-clock time is rebuilt by
  rendering in the time zone set in Settings, never stored separately.
- Intervals are half-open, `[start, end)`. A 10:00–11:00 meeting and an 11:00–12:00 call do not
  overlap.
- All-day runs midnight to **exclusive** midnight: Nov 5–7 is stored as Nov 5 00:00 → Nov 8
  00:00, matching Google's `start.date`/`end.date`.
- Travel is all-day and multi-day, departure through return.

**Conflicts.** Two timed events clash when they overlap. An all-day event only clashes when it
is **Travel** — you are on a plane; you are not at a birthday all day — so a synced calendar full
of holidays and birthdays stays quiet. Two Basketball events never clash either: a practice
inside a team event is normal. A timed event running into protected time is flagged too.

Clashes appear on both events and on Command for the next 14 days. **Acknowledge** hides a pair,
and moving either event brings it back.

Events from Google or an import are read-only apart from notes, and say where they came from.

## Quick capture

One line on Command, or the bar fixed to the bottom of the screen on a phone. Tokens are
optional, work anywhere in the line, and are stripped from the title:

| Token | Does |
| --- | --- |
| `#collective` `#basketball` `#family` `#misc` | sets the arena |
| `!urgent` `!high` `!normal` `!low` | sets the priority |
| `due:today` `due:tomorrow` `due:mon`…`due:sun` `due:2026-12-01` | sets the due date |

`Call coach re: film session #basketball !high due:tomorrow` becomes a basketball task, high
priority, due tomorrow, titled "Call coach re: film session".

Every capture lands in the **Misc inbox** until it is sorted, even a tagged one. Dates resolve in
the time zone set in Settings. Anything the parser does not recognise is left in the title, so a
mistyped token is visible rather than silently dropped.

## Run locally

Needs Node 22+. No keys required: the app uses an embedded Postgres (PGlite) in `.data/` when `DATABASE_URL` is empty.

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev          # http://localhost:3000, first visit goes to /setup
```

Stop the dev server before running `db:migrate` or `db:seed`: the embedded database allows one process at a time.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run typecheck` / `npm test` | TypeScript check / unit tests |
| `npm run build` / `npm start` | Production build / server |
| `npm run check` | Typecheck + tests + build: the gate before every push |
| `npm run db:generate` | Write a new migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (embedded DB or `DATABASE_URL`) |
| `npm run db:seed` | Starter boards, draft pipelines, settings row (safe to re-run) |

## Environment

See `.env.example`. In production `AUTH_SECRET` and `DATABASE_URL` are required; the app refuses to start without them. Locally random dev secrets are written to `.data/dev-auth-secret` and `.data/dev-encryption-key` (both git-ignored). To run `npm start` against the embedded DB, set `ALLOW_EMBEDDED_DB=1`.

`ENCRYPTION_KEY` must decode to exactly 32 bytes. `CRON_SECRET` authenticates the scheduler; without it `/api/cron/tick` answers 503 and no job runs.

## Scheduled jobs

One cron tick runs every due job in sequence. `vercel.json` schedules `/api/cron/tick` every
5 minutes, and Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the variable is set.

| Job | Cadence | Ships in |
| --- | --- | --- |
| `google-sync` | every 10 min | M4 |
| `approvals-deliver` | every 5 min | M8 |
| `daily-brief` | daily after 06:30 local | M9 |
| `learning-review` | Sundays after 18:00 local | M7 |

All four are registered now and report `skipped` until their milestone lands. Every run that
happens is recorded in `job_runs` and the last 10 per job are shown in Settings. A job that fails
is recorded and never blocks the others in the same tick.

**Vercel Hobby only allows daily crons.** On Hobby, change the schedule in `vercel.json` to
`0 11 * * *` and use the "Sync now" buttons that arrive with M4 and M8. Confirm the plan at deploy.

Run one tick by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

## Export

Settings → Export my data downloads every table as one JSON file. The password hash and the
encrypted connection keys are withheld.

## Google Calendar (Family arena)

Read-only. The OS never writes to Google in v1.

1. In `console.cloud.google.com`, enable the Google Calendar API and create an **OAuth client
   ID** of type *Web application*.
2. Set its authorised redirect URI to exactly `${APP_URL}/api/google/callback` — Settings →
   Connections prints the exact string to paste.
3. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, set `APP_URL`,
   and restart.
4. **Publish the app.** A client left in *Testing* issues refresh tokens that expire after seven
   days, so the connection breaks every week. A single-user, unverified published app is fine
   for your own account.
5. Settings → Connections → Connect Google Calendar, then tick the calendars that feed Family.

Syncs every ten minutes (daily on Vercel Hobby — use **Sync now**), over a window of 7 days back
to 120 days ahead. Recurring events arrive as individual instances. Synced events are read-only
apart from their notes, which no sync will ever overwrite; everything else lives in Google and
each event links back to it.

If Google revokes access — or the Testing-mode expiry hits — the connection is marked broken,
syncing stops, and both Settings and Command say to reconnect.

## Contacts and Pipelines

**Contacts** is one search box over everything you might remember someone by — either name,
email, phone, a tag, or their organisation — with a multi-select filter by type (Client,
Prospect, Partner, Investor, Team, Athlete, Parent, Vendor).

Each contact's page merges three histories into one feed, newest first: notes, calls and
meetings you logged; tasks linked to them that got finished; and anything drafted to them
through Approvals. It pages with a cursor, so a long history stays fast.

**Do not contact** is a flag with teeth. It is enforced in the service, not the form, so nothing
— no automation, and not the Operator — can draft a message to someone carrying it.

**Pipelines** is a board per pipeline. A deal with no next step, or one whose next step is past
due, gets a red edge and says which. That is the point of the screen: a board that looked calm
while deals went quiet would be worse than no board. Values are typed the way you say them —
`$1,250` — and stored as integer cents.

Moving a deal records the move ("Quote sent → Deposit") on both the deal and the contact, which
is what Command's "Deals moved · 7 days" counts.

### Handoffs

Two automations, both of which create a **task inside the OS**. Nothing is sent, and nobody is
notified.

| When | What |
| --- | --- |
| A deal reaches a billing stage | "Invoice: …" for Ahmad, due in 2 business days |
| A contact becomes a Client | "Onboard: …" for Kenza, due in 2 business days |

Each is created at most once: repeated moves, out-and-back moves and double clicks all produce
one task, enforced by a unique key in the database rather than by a check that could be missed.

### Editing stages

Settings → Pipelines. The seeded stages are drafts. Renaming a stage **moves the deals standing
in it** and keeps its billing flag; removing a stage that still has deals is refused and says how
many.

## Approvals

**Nothing reaches another person without Devon's yes.** Every outbound action — an email, a
text, a calendar write — is created as a row in `approvals` and waits. No module, automation or
Operator tool may call a provider directly; `createApproval` is the only way to express the
intent, and approving is the only way it moves.

`/approvals` has four tabs: **Waiting · Scheduled · Failed · History**. Each card shows who
drafted it (you, the Operator or an automation), who it is addressed to, and the full payload in
an editable form.

**Pressing Enter in a card saves. It never approves.** The decision buttons sit outside the
editable form, so a reflex cannot send something.

### What happens when you approve

- **In sandbox**, the approval goes straight to History marked sent/sandbox, and a line is added
  to the contact's timeline: *"Sandbox: would have sent …"*. There is no code path from sandbox
  to a provider — not a flag that gets checked, a different branch that ends first.
- **In live**, it is scheduled, then claimed and delivered by the `approvals-deliver` job every
  five minutes. A scheduled item can still be cancelled; a claimed one cannot.

A failed delivery goes to Failed with its reason and waits for you — nothing is retried
automatically, because that is how one message becomes three. **Back to Waiting** puts it back
for another look.

### This version cannot send

v1 ships only a no-op provider. Every delivery fails with "No email provider connected" or the
equivalent, and **going live is refused** — even with LIVE typed — until a real provider exists.
That is deliberate: PRD §10's gate to v2 is a full week run in sandbox. Resend and Twilio arrive
in v2.

## Learning

`/learning` tracks skills — where you are, where you want to be, and the only number that tells
the truth: **minutes actually logged**, over 7 days and 30.

Practice is one button. **+15m, +30m, +60m** against today, with a fuller form for another day or
an odd amount. Logging twice in a day adds; it never replaces.

Each skill holds learning items — a course, a book, a video or a project — with a status, a due
date and a link.

### The weekly review

Written every Sunday evening by the `learning-review` job, and on demand with **Write it now**.
It covers minutes per skill this week against last, anything **stalled** (an active item whose
skill has had no practice for two weeks), anything **past due**, and exactly one next step per
skill. One step, not a list — the rest of the OS is already where backlogs live.

The review is computed as data first, then written two ways. Without a model key a deterministic
template renders it, so the same week always reads the same. With `ANTHROPIC_API_KEY` set,
`SUMMARY_MODEL` rewrites it more readably — but every number is computed and handed over already
resolved, and the model is told not to calculate anything. If the call fails, the offline text is
what gets stored. The review says which wrote it.

Each review is stored as the text it was that Sunday, not recomputed on read: a record, not a
view.

## Importing the team schedule

`/schedule/import`. Basketball only, and nothing is written until you have seen a preview and
confirmed it.

- **CSV or TSV**, pasted or uploaded. Header line, then
  `date, start, end, type, title, location, notes` — plus `end_date` for travel. Column names
  are matched loosely, and dates and times accept the usual forms (`2026-11-07` or `11/7/2026`,
  `18:00` or `6:00 PM`).
- **Types**: practice, s&c, team event, game, travel.
- **A missing end time** is assumed — two hours for a game, ninety minutes otherwise — and the
  preview flags every row it guessed on.
- **A PDF, an image or free text** goes through the model instead, and needs `ANTHROPIC_API_KEY`.
  Without a key those options are disabled with a line saying so. The document is treated as
  data, never as instructions, and every row it produces still faces the same preview.

The preview groups rows into new, changed, unchanged, and will-be-removed. **Removal only ever
touches future events** that an earlier import created and this file no longer contains; past
events are always kept.

Importing the same file twice changes nothing — identity comes from the content, so a re-run is
a genuine no-op. Changing one row's time updates that one event in place, keeping its notes and
any conflict you acknowledged. Notes you write on an imported event are never overwritten by a
later import.

`docs/samples/basketball-schedule.csv` is a clearly-labelled fictional file for trying it out.

## Deploy (Vercel + Supabase)

1. Create a Supabase project. Copy the pooled connection string (transaction pooler, port 6543) into `DATABASE_URL`.
2. Import this repo in Vercel. Set `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` (`openssl rand -base64 32` each), `DATABASE_URL`, `APP_URL`, `OS_TIMEZONE`, the two `GOOGLE_*` variables, and `ANTHROPIC_API_KEY`.
3. Run `DATABASE_URL=... npm run db:migrate && npm run db:seed` once from your machine.
4. Open the deployed URL. It goes to `/setup`.

## How it's built

- Next.js 15 (App Router, server actions), React 19, TypeScript, Tailwind 4.
- Drizzle ORM. `src/db/schema.ts` is the source of truth; every foreign key is indexed; money is integer cents.
- Single owner, so there is no tenant isolation layer. If the OS is resold as a multi-user product, add an owner/tenant id to every table and Postgres RLS before the second user exists.
- Auth: scrypt password hash, HMAC-signed cookie. Middleware checks the signature; the signed-in layout re-checks a session version in the database, so a password change signs out every other device.
- Sign-in is limited to 5 failures per 15 minutes per IP. The window is in memory, so on Vercel it is per function instance; move it to a shared store before going public.
- Nothing reaches another person without an approval. The `approvals` table carries an idempotency key so a retried send cannot fire twice. Sandbox mode records approvals and delivers nothing.
- Look: theme tokens live in `src/app/globals.css` (`@theme`). Current skin is the Collective AI parent system: deep navy, amber gold, Space Grotesk, JetBrains Mono. Swap the tokens to re-skin.

## Corrections to the PRD

`docs/PRD.md` §6 names the models `claude-sonnet-5-5` and `claude-haiku-5-5`. **Neither id
exists.** The code uses `claude-sonnet-5` (overridable with `OPERATOR_MODEL`) and
`claude-haiku-4-5-20251001` (overridable with `SUMMARY_MODEL`). Worth fixing in the PRD before
M9 builds the Operator on those lines.

## Known advisories

`npm audit` flags PostCSS inside Next's own bundled copy. It affects CSS processing at build time with attacker-controlled CSS, which this app does not take. It clears when Next ships the patched PostCSS.
