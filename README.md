# DScott OS

Devon Scott's operating system: one home base for Collective AI, basketball, family and everything else. Built from Blueprint v0.1. It is also the pilot for the OS-building process: decisions made here are logged so the next OS starts from them.

## Status: Phase 0 (scaffold)

| Done | Not yet |
| --- | --- |
| Owner account (`/setup`, `/login`), signed 30-day session, sign-out | Schedule, Work, Learning, Contacts, Pipelines, Approvals, Operator (v1) |
| Command screen reading live counts from the database | Google Calendar sync for Family (v1) |
| Settings: delivery mode (sandbox ⇄ live with typed confirm), password change | Basketball schedule import, waiting on the official schedule (v1) |
| Schema for all v1 tables, tracked migrations, idempotent seed | Vercel project + Supabase database (needs a Supabase project) |
| Health check at `/api/health`, security headers | Shared rate limit store (current limit is per instance) |

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

See `.env.example`. In production `AUTH_SECRET` and `DATABASE_URL` are required; the app refuses to start without them. Locally a random dev secret is written to `.data/dev-auth-secret` (git-ignored). To run `npm start` against the embedded DB, set `ALLOW_EMBEDDED_DB=1`.

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
