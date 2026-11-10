# DScott OS: working rules

- Build plan: `docs/PRD.md` (milestones M1–M10, acceptance criteria, defaults for open decisions). Product scope comes from "Devon OS — Blueprint v0.1" (Claude Docs). Arenas: collective, basketball, family, misc. Kinetic Edge, Civic Sports and client builds live in the collective arena.
- Project law, Rule 1: Pamela OS may inform structure only. Never use Pamela's name, A Cup of Compassion, its brand, phone numbers, contacts, pipeline stages, booking types, receptionist script or copy from her manual.
- Nothing outbound (email, text, calendar write, post, payment) is sent directly. It becomes a row in `approvals`; delivery happens only after Devon approves and only in live mode.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`. Never hand-edit applied migrations. Index every foreign key. Money is integer cents.
- No secrets in code. Env vars or encrypted `settings.encrypted_keys` only.
- Model ids have a shelf life. They live in one module (`src/lib/model.ts`), are imported from there rather than typed into a feature, and are confirmed against the provider's current model list before being written into a spec, a plan or the PRD. A wrong id is valid-looking text that fails only at the first real call.
- Credentials and secrets are per instance. This repo's `.env.local` Google credentials are deliberate placeholders; a new instance or a new OS needs its own OAuth client and its own `AUTH_SECRET`, `ENCRYPTION_KEY` and `CRON_SECRET`. See `docs/CONTEXT.md` → "Before the next OS is built from this one".
- Work moves DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP. Read `docs/CONTEXT.md` first: it holds domain terms, where specs, plans and ADRs go, and the gate for each stage.
- Every module starts with a spec in `docs/specs/` before code. Root-cause a bug before changing code for it.
- Before pushing: `npm run check` (typecheck, tests, production build).
- UI: tokens in `src/app/globals.css`; no gradients, glass or glow by default; semantic HTML; planned screens appear in the sidebar without links, never as dead links.
- Log decisions made at each phase gate in `docs/build-log.md`; that log becomes the reusable OS template.
