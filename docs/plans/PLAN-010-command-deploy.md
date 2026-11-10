# PLAN-010 · M10 Command complete + deploy

**Spec:** `docs/specs/SPEC-010-command-deploy.md` · **Branch:** `m10-command-deploy`
**Status:** SHIPPED 2026-11-10

Six tasks. The Needs-attention sources land first because they are the only new logic in the
milestone; everything after that is arrangement, a button, and writing things down.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/lib/attention.ts` | the five Needs-attention sources, pure where it can be |
| `src/modules/schedule/components/today.tsx` | today's agenda on Command |
| `src/modules/jobs/actions.ts` | `runJobNowAction` |
| `src/modules/jobs/components/run-now.tsx` | the button |
| `docs/runbook.md` | the operations document |
| `tests/command.attention.test.ts` | every source, every boundary (PGlite) |
| `tests/jobs.run-now.test.ts` | one job, recorded, not due, no session |

### Changed

| File | Change |
| --- | --- |
| `src/lib/command.ts` | the new sources, today's events, ordering |
| `src/app/(os)/page.tsx` | the eight sections in order |
| `src/modules/operator/components/brief-panel.tsx` | collapsible, `?brief=closed` |
| `src/app/(os)/settings/page.tsx` | Run now per job |
| `src/modules/jobs/registry.ts` | `daily-brief` window 06:30 → 05:00 |
| `vercel.json` | `0 11 * * *` |
| `tests/jobs.schedule.test.ts` | the new window, both offsets |
| `README.md`, `docs/build-log.md` | status, deploy steps, SHIP entry |

---

## Tasks

**T1 · The cron window.** Widen `daily-brief` to 05:00 and set `vercel.json` to the daily
schedule, with a test that the job is due at both 06:00 and 07:00 local. This is first because
it is the one thing that would silently not work in production, and the only reason to notice is
that it is November.

**T2 · Needs attention.** The three new sources in `src/lib/attention.ts`, tested at their
boundaries — 24 hours for a failed job, 7 days for a capture, today for a next step. Ordering by
cost of ignoring.

**T3 · Today's schedule.** A component over `eventsInRange`, all-day first, with its empty state.

**T4 · Command.** The eight sections in §2's order, and the brief collapsible on `?brief=closed`.

**T5 · Run now.** The action, the button, and the four tests. It goes through `runJob`, skipping
only the due check.

**T6 · Ship.** The runbook, README deploy steps, `npm run check`, `npm audit --omit=dev`, a
browser pass over Command at 1280 and 375 with every panel populated and then emptied, build log,
push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6.

| Risk | Handling |
| --- | --- |
| **The brief never running in production** | The reason M10 exists in November: 11:00 UTC is 06:00 EST, before a 06:30 window. Window widened, tested at both offsets |
| Needs attention becoming wallpaper | Hidden when empty, ordered by cost, every row says what clears it |
| Run now becoming a second cron route | It is a server action behind `requireOwner()`, not a route; tested for the no-session case |
| A manual run that does nothing | The due check is skipped — on a daily cron that is the whole point of the button |
| The runbook being written for a developer | Written as "something is wrong at 7am": symptom first, then the fix |
| The deploy needing credentials I do not have | Out of scope by §1; the runbook is the handoff and the build log says so |
