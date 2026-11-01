# DScott OS: working rules

- Source of truth for scope is "Devon OS — Blueprint v0.1" (Claude Docs). Arenas: collective, basketball, family, misc. Kinetic Edge, Civic Sports and client builds live in the collective arena.
- Project law, Rule 1: Pamela OS may inform structure only. Never use Pamela's name, A Cup of Compassion, its brand, phone numbers, contacts, pipeline stages, booking types, receptionist script or copy from her manual.
- Nothing outbound (email, text, calendar write, post, payment) is sent directly. It becomes a row in `approvals`; delivery happens only after Devon approves and only in live mode.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`. Never hand-edit applied migrations. Index every foreign key. Money is integer cents.
- No secrets in code. Env vars or encrypted `settings.encrypted_keys` only.
- Before pushing: `npm run typecheck && npm test && npm run build`.
- UI: tokens in `src/app/globals.css`; no gradients, glass or glow by default; semantic HTML; planned screens appear in the sidebar without links, never as dead links.
- Log decisions made at each phase gate in `docs/build-log.md`; that log becomes the reusable OS template.
