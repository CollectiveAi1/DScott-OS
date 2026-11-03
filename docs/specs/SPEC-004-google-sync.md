# SPEC-004 · M4 Family sync (Google Calendar, read-only)

**Milestone:** M4 (PRD §8.4) · **Depends on:** M1, M3 · **Branch:** `m4-google-sync`
**Status:** SHIPPED 2026-11-03

Devon's family calendar lives in Gmail and is going to stay there. This milestone reads it into
the Family arena so a school concert collides with a client call *in the OS*, before it collides
in real life.

It is the first module that talks to someone else's server. Everything that makes that
different — tokens, expiry, revocation, paging, partial failure — is handled here so the modules
after it inherit the pattern rather than reinvent it.

**Read-only, in both directions of meaning.** The OS never writes to Google in v1, and a synced
row is not Devon's to edit except for its notes. Write-back is a v2 item and goes through
Approvals when it comes.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | OAuth 2.0 web flow with a signed, expiring `state` cookie | §8.4 |
| 2 | Tokens encrypted into `settings.encrypted_keys.google` | §8.4, §6.4 |
| 3 | Calendar picker: which calendars feed Family | §8.4 |
| 4 | Sync: page through `events.list`, upsert, remove what is gone | §8.4 |
| 5 | The `google-sync` job body, replacing M1's stub | §8.1 |
| 6 | "Sync now" in Settings | §8.4 |
| 7 | Token refresh, and a broken connection that says so and stops | §8.4 |
| 8 | Disconnect: revoke, forget, remove synced events, with confirm | §8.4 |
| 9 | `calendar_events.external_url`; `calendar_sources` gains `summary`, `lastSyncedAt`, `lastError` | §6.2 |
| 10 | The all-day conflict rule, narrowed — the M3 flag, now decided | §8.3 |

### Out of scope

- Writing to Google. v2, through Approvals.
- Any calendar feeding an arena other than Family. The picker stores an arena per source so v2
  can widen it; v1 writes `family` and nothing else.
- Webhooks or incremental `syncToken`. A 10-minute poll over a 127-day window is small and has
  no state to go stale. Revisit if the window or the calendar count grows.

---

## 2. The decision carried in from M3

The M3 build log flagged that the conflict rule, as PRD §8.3 states it, makes **any** all-day
event clash with every timed event it covers. Devon decided at this gate: **only Travel.**

Rule 5 becomes: *when one side is all-day, there is a conflict only if that side is Travel.*
Timed-vs-timed is untouched, so the meeting-against-a-game case still works exactly as before.
Birthdays, holidays and school closures — which is most of what this milestone is about to
import — stay quiet.

An all-day Collective deadline no longer flags against that day's meetings. That is the accepted
cost, and it is defensible: a deadline does not occupy hours.

---

## 3. Talking to Google

### 3.1 Connecting

- `GET /api/google/start` builds the consent URL: scope
  `https://www.googleapis.com/auth/calendar.readonly`, `access_type=offline`, `prompt=consent`
  (so a refresh token arrives every time, not only the first), and a `state` value.
- **`state` is an HMAC-signed token in an httpOnly cookie**, carrying a nonce and an expiry ten
  minutes out, signed with `AUTH_SECRET` the same way the session cookie is. The callback
  accepts the code only if the returned `state` matches the cookie and has not expired. That is
  what stops a stray callback URL from attaching someone else's calendar.
- `GET /api/google/callback` exchanges the code, encrypts the tokens, and clears the cookie.
  Both routes sit behind the session: only a signed-in Devon can connect his own calendar.
- Google's own error (`?error=access_denied`) comes back as a readable line in Settings, not a
  stack trace.

### 3.2 Tokens

Stored as one encrypted blob in `settings.encrypted_keys.google`:
`{ accessToken, refreshToken, expiresAt }`. Never sent to the browser, never logged, never in
the export (M1 already withholds `encrypted_keys` wholesale).

- The access token is refreshed when it is within 60 seconds of expiry, and again on a 401.
- **A refresh that fails with `invalid_grant` is terminal**: the user revoked access, or the
  Testing-mode seven-day expiry hit. The connection is marked broken, the job stops, and
  Settings and Command → Needs attention both say "Reconnect". Retrying would only burn requests.
- Every other failure is transient: it is recorded on the source as `lastError` and the next
  tick tries again.

### 3.3 The API surface

One narrow interface — `listCalendars` and `listEvents` — because that is all this module needs,
and because the sync takes it as an argument. The tests pass a fake built from recorded
fixtures and make no network calls at all; nothing in the test suite knows Google's hostname.

Timeouts and one retry on 429/5xx, per §6.1. Validation and auth errors fail immediately.

---

## 4. Syncing

For each picked calendar, with `singleEvents=true` (so a recurring event arrives as individual
instances and needs no special handling), `timeMin` = now − 7 days, `timeMax` = now + 120 days,
following `pageToken` to the end.

### Mapping

| Google | Row |
| --- | --- |
| `summary` | `title`, or "(no title)" when Google has none |
| `start.date` / `end.date` | all-day; `end.date` is already exclusive, so it is copied straight in |
| `start.dateTime` / `end.dateTime` | timed instants |
| `id` | `externalId` = `<calendarId>:<id>` |
| `htmlLink` | `externalUrl` |
| `location` | `location` |
| — | `arena` = family, `kind` = family, `source` = google, `createdBy` = automation |

**`description` is deliberately not imported.** `notes` is the one field Devon can edit on a
synced row (M3), and a sync that overwrote it every ten minutes would make it useless. The
description stays one click away through `externalUrl`.

The exclusive all-day end is why M3 chose that storage shape: this is a copy, not a conversion.

### Removing what is gone

After a calendar's pages are **all** read successfully, local `google` rows for that calendar
whose window overlaps the synced range and that were not returned — or came back `cancelled` —
are deleted.

**A partial read never deletes.** If page three fails, the run records the error and leaves every
row alone. Deleting on incomplete data would silently empty Devon's calendar, and that is the
worst thing this module could do.

### Recording the run

Each source carries `lastSyncedAt` and `lastError`. The job returns a one-line summary
("Hale family: 24 events, 2 removed") into `job_runs`, so Settings shows what happened without
anyone reading logs.

---

## 5. Settings → Connections

- Not configured (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing): says exactly which
  variables to set and what the callback URL has to be.
- Not connected: "Connect Google Calendar".
- Connected: the account, the calendar list with checkboxes, each picked source's last sync and
  last error, "Sync now", and "Disconnect".
- Broken: a plain statement of what happened and a "Reconnect" button, which re-runs consent.
- Disconnect takes two presses, revokes the token at Google, forgets it, and deletes the synced
  events. The second press says how many events will go.

---

## 6. Schema

| Change | Detail |
| --- | --- |
| `calendar_events.external_url text` | Link back to the Google event |
| `CalendarSource` type | `{ provider, calendarId, summary, arena, lastSyncedAt?, lastError? }` — jsonb, no migration |

---

## 7. Acceptance criteria

1. **A new event appears, an edited one updates in place, a deleted one disappears** — the same
   `externalId` is never duplicated across syncs. ✔ test, fixtures
2. **A recurring event arrives as individual instances.** ✔ test, fixtures
3. **Paging** is followed to the end; events on page two land exactly like page one. ✔ test
4. **A `cancelled` event is removed.** ✔ test
5. **A failed page deletes nothing** and records the error. ✔ test
6. **A broken token marks the connection, stops the job and never throws** — the cron tick still
   reports and still runs the jobs after it. ✔ test
7. **All-day mapping** round-trips Google's exclusive end into the stored exclusive end, and a
   one-day all-day event does not bleed into the next day. ✔ test
8. **`description` never overwrites `notes`**, across repeated syncs. ✔ test
9. **The `state` cookie** rejects a missing, altered, foreign-signed or expired state. ✔ test
10. **The narrowed conflict rule**: an all-day Family event no longer clashes with a timed
    event; Travel still does; timed-vs-timed is unchanged. ✔ test
11. **No test makes a network call.**
12. **`npm run check` is green.**

---

## 8. Accepted trade-offs

- **Polling, not webhooks.** Push notifications need a public HTTPS endpoint, channel renewal
  and a re-sync path when a channel lapses. A 10-minute poll over 127 days is a few hundred rows
  and has no state to break.
- **The whole window every time, no `syncToken`.** An incremental token is a cache that can go
  stale in ways that are hard to detect. Re-reading is idempotent by construction.
- **One encrypted blob rather than a credentials table.** One owner, one Google account. A
  second provider gets its own key in the same object.
- **The seven-day Testing-mode expiry is a documentation problem, not a code one.** Nothing in
  the code can extend it. The README says to publish the app, and a broken connection says so
  plainly instead of failing quietly.

---

## 9. Changed during BUILD

### Disconnect is reachable from a broken connection

The panel first offered only "Reconnect" once a grant was revoked. That leaves the synced events
with no way to clear them short of reconnecting to an account Devon may have deliberately cut
off. Both buttons are there now.

### `tests/google.oauth.test.ts` was not in the plan

The consent URL and the callback's state handling are the security-carrying parts of the flow
and cannot be exercised in a browser without a real Google account. They are pure enough to test
directly, so they are: scope is read-only and single, `access_type=offline` and `prompt=consent`
are both set, and the callback refuses a mismatched, absent, expired or unsigned state.

### The M1 cron test was asserting a stub

`tests/cron.route.test.ts` checked that `google-sync` reported "Ships in M4.". It now reports
why it actually skipped ("No calendars are feeding Family yet."), which is the better message.
The test asserts the real reason, and still checks that a job which genuinely has not shipped
says so.
