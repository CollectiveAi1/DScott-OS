# PLAN-004 · M4 Family sync

**Spec:** `docs/specs/SPEC-004-google-sync.md` · **Branch:** `m4-google-sync`
**Status:** SHIPPED 2026-11-03

Eight tasks. The pure parts — the signed state, the event mapping, the sync algorithm — land and
are tested against fixtures before any HTTP exists, so the whole module is provable without a
Google account.

---

## Files

### New

| File | Purpose |
| --- | --- |
| `src/modules/google/state.ts` | signed, expiring OAuth `state` |
| `src/modules/google/map-event.ts` | pure: a Google event → a row, or "delete this" |
| `src/modules/google/api.ts` | the real HTTP client: tokens, calendars, events |
| `src/modules/google/tokens.ts` | read, refresh and store the encrypted token blob |
| `src/modules/google/sync.ts` | the algorithm, over an injected API |
| `src/modules/google/service.ts` | connect, disconnect, pick calendars, sync now |
| `src/modules/google/actions.ts` | `"use server"` wrappers |
| `src/modules/google/components/connection.tsx` | the Settings panel |
| `src/app/api/google/start/route.ts` | begin consent |
| `src/app/api/google/callback/route.ts` | finish consent |
| `tests/fixtures/google/*.json` | recorded responses: create, update, cancel, recurring, paging |
| `tests/google.state.test.ts` | the state token |
| `tests/google.map-event.test.ts` | mapping, all-day, missing fields |
| `tests/google.sync.test.ts` | the algorithm against fixtures, with a fake API (PGlite) |

### Changed

| File | Change |
| --- | --- |
| `src/db/schema.ts` | `calendar_events.external_url`; widen the `CalendarSource` type |
| `drizzle/0004_google.sql` (+ meta) | generated, committed |
| `src/modules/schedule/conflicts.ts` | rule 5 narrowed to Travel |
| `tests/schedule.conflicts.test.ts` | the narrowed rule |
| `docs/specs/SPEC-003-schedule.md` | note that the flagged question is resolved |
| `src/modules/jobs/registry.ts` | the real `google-sync` handler |
| `src/app/(os)/settings/page.tsx` | the Connections panel |
| `src/lib/command.ts`, `src/app/(os)/page.tsx` | a broken connection in Needs attention |
| `src/modules/schedule/components/event-chip.tsx` or the event form | show `externalUrl` |
| `.env.example`, `README.md`, `docs/build-log.md` | setup, the Testing-mode warning, SHIP entry |

---

## Tasks

**T1 · The conflict rule.** Narrow rule 5, update its tests, note the resolution in SPEC-003.
Small, independent, and it stops the noise before any data arrives to be noisy.

**T2 · Schema.** `external_url` and the widened `CalendarSource`, then
`npm run db:generate -- --name google`.

**T3 · Signed state.** Pure, tested: tamper, expiry, wrong secret, missing.

**T4 · Mapping.** Pure, tested against fixtures: all-day, timed, missing summary, cancelled,
a recurring instance.

**T5 · Sync.** The algorithm over an injected API. Fixtures drive create, update, cancel,
paging, and the failure that must not delete. PGlite for the rows.

**T6 · HTTP and tokens.** `api.ts` and `tokens.ts`: exchange, refresh, revoke, list, page.
Timeouts, one retry on 429/5xx, `invalid_grant` treated as terminal.

**T7 · Routes, Settings, job.** Start and callback routes, the Connections panel, "Sync now",
Disconnect, the real job handler, Needs attention.

**T8 · Ship.** `npm run check`, `npm audit --omit=dev`, a browser pass over every state the panel
can be in (not configured, not connected, broken), README setup including the Testing-mode
warning, build log, push.

---

## Order and risk

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8. T5 is the heart of it and is reachable without T6,
because the sync takes its API as an argument.

| Risk | Handling |
| --- | --- |
| No Google credentials to test against | The sync takes an injected API; fixtures cover every case in the acceptance list. The panel's "not configured" state is a first-class screen, not an error |
| A partial read deleting real events | Deletion only runs after every page of a calendar has been read; a test asserts a mid-page failure deletes nothing |
| A sync overwriting Devon's notes | `description` is never imported; a test syncs twice around an edit |
| Token refresh looping on a revoked grant | `invalid_grant` is terminal and marks the connection broken; everything else is transient |
| Timezone drift between Google's dates and the stored instants | All-day uses M3's `startOfDayInstant` in the settings zone; the exclusive end is copied, not computed |
