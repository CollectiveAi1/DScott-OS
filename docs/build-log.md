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
