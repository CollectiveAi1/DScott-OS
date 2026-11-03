# DScott OS

Devon Scott's operating system: one home base for Collective AI, basketball, family and everything else. Built from Blueprint v0.1. It is also the pilot for the OS-building process: decisions made here are logged so the next OS starts from them.

## Status: M2 shipped (Work + Misc capture)

| Done | Not yet |
| --- | --- |
| Owner account (`/setup`, `/login`), signed 30-day session, sign-out | Schedule, Learning, Contacts, Pipelines, Approvals, Operator (M3–M9) |
| Quick capture with `#arena`, `!priority` and `due:` tokens, on Command and the phone bar | Google Calendar sync for Family (M4) |
| Work: Misc inbox, board and list views, filters, move, complete, task drawer, projects | Basketball schedule import, waiting on the official schedule (M5) |
| Command: capture, live tiles, due this week, Needs attention | Vercel project + Supabase database (needs a Supabase project) |
| Settings: delivery mode, time zone, protected time, data export, job history, password | The four job bodies — each ships with its own milestone |
| Encryption for stored keys, job runner, `/api/cron/tick` | Shared rate limit store (current limit is per instance) |
| Schema for all v1 tables, tracked migrations, idempotent seed | |
| Health check at `/api/health`, security headers | |

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

## Deploy (Vercel + Supabase)

1. Create a Supabase project. Copy the pooled connection string (transaction pooler, port 6543) into `DATABASE_URL`.
2. Import this repo in Vercel. Set `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` (`openssl rand -base64 32` each), `DATABASE_URL`, `APP_URL`, `OS_TIMEZONE`.
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

## Known advisories

`npm audit` flags PostCSS inside Next's own bundled copy. It affects CSS processing at build time with attacker-controlled CSS, which this app does not take. It clears when Next ships the patched PostCSS.
