# SPEC-001 · M1 Foundations

**Milestone:** M1 (PRD §8.1) · **Depends on:** nothing · **Branch:** `m1-foundations`
**Status:** SHIPPED 2026-11-02

M1 builds the plumbing every later module leans on: encryption for stored OAuth tokens, a job
runner with a recorded history, the cron entry point, the Settings editors Devon needs before any
date logic matters (time zone, protected time), and a full data export.

Nothing in M1 is user-facing work; it is the floor the other nine milestones stand on. No module
after this one should have to invent its own way to store a secret, run on a schedule, or know
what "today" means.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | `src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt for `settings.encrypted_keys` | §8.1, §6.4 |
| 2 | `job_runs` table + migration | §6.2 |
| 3 | `src/modules/jobs/` — `runJob`, job registry, pure due-check | §8.1 |
| 4 | `GET /api/cron/tick` — bearer-authenticated, runs due jobs in sequence | §8.1 |
| 5 | `vercel.json` cron schedule | §8.1 |
| 6 | Settings: time zone editor (IANA, validated) | §8.1 |
| 7 | Settings: protected-time editor (≤ 10 blocks) | §8.1 |
| 8 | Settings: "Export my data" JSON download | §8.1 |
| 9 | Settings: last 10 `job_runs` per job with status | §8.1 |

### Out of scope

- The job *handlers* for `google-sync` (M4), `approvals-deliver` (M8), `daily-brief` (M9) and
  `learning-review` (M7). M1 registers all four with stub handlers that report `skipped`, so the
  schedule, the recording and the response shape are provable today and each milestone only has
  to swap in a body.
- "Sync now" buttons (M4, M8 own them).
- Any import of protected time into conflict detection — that is M3's conflict rule.
- Pruning old `job_runs` rows (see §7).

---

## 2. Encryption (`src/lib/crypto.ts`)

```
encrypt(plaintext: string): string
decrypt(ciphertext: string): string   // throws on tamper, wrong key, or malformed input
```

- AES-256-GCM, fresh random 12-byte IV per call, 16-byte auth tag.
- Output: `v1:<iv>:<tag>:<ciphertext>`, each part base64url. The `v1` prefix exists so a future
  key rotation or algorithm change can be told apart from old values.
- Key: `ENCRYPTION_KEY`, 32 bytes base64-encoded. In local development the key is generated once
  into `.data/dev-encryption-key` (mode 0600, git-ignored), exactly as `AUTH_SECRET` already is in
  `src/lib/auth/secret.ts`. Production without the env var is a startup error.
- A wrong-length or non-base64 `ENCRYPTION_KEY` fails loudly at first use, not silently.
- `decrypt` throws a plain `Error` with no key or ciphertext material in the message.

**Edge cases:** empty-string plaintext round-trips; a value with a swapped IV, a flipped
ciphertext byte, a truncated tag, a missing section, or an unknown version prefix all throw.

---

## 3. Job runner (`src/modules/jobs/`)

### 3.1 `job_runs` table

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `job` | text not null | registry name |
| `started_at` | timestamptz not null | |
| `finished_at` | timestamptz not null | |
| `status` | enum `job_status` (`ok`, `error`, `skipped`) | |
| `detail` | text | one line, written for Devon |
| stamps | | `created_at`, `updated_at` as everywhere else |

Index: `(job, started_at desc)` — the Settings panel's only query shape.

### 3.2 `runJob`

```
runJob(db, name, handler): Promise<JobRun>
```

- Records `startedAt`, runs the handler, records `finishedAt`, writes one `job_runs` row, returns it.
- **Never throws to the caller.** A handler that throws becomes `status = "error"` with a
  sanitised one-line detail; no stack traces, no DB error text, nothing resembling a token.
- A handler returns `{ status: "ok" | "skipped", detail?: string }`. `skipped` is a real outcome:
  it is how a job says "nothing to do" or "not built yet".
- The row is written after the handler settles. A process killed mid-job leaves no row, which is
  honest — there is no `running` state to go stale.

### 3.3 Schedules — pure, unit-tested

`isJobDue(schedule, lastRunStartedAt, now, timeZone): boolean`. Three schedule kinds cover the
four v1 jobs:

| Kind | Shape | Due when |
| --- | --- | --- |
| `interval` | `{ everyMinutes }` | no previous run, or `now - lastRun >= everyMinutes - 1 min` |
| `dailyAfter` | `{ time: "HH:MM" }` | local time ≥ `time` and no run recorded on today's local date |
| `weeklyAfter` | `{ weekday, time }` | local weekday matches, local time ≥ `time`, no run on today's local date |

The one-minute grace on `interval` exists because a 5-minute cron that fires at 9 min 58 s would
otherwise defer a 10-minute job by a whole tick. All "local" reasoning uses
`settings.timezone` through `src/lib/dates.ts`; never the server's clock zone.

### 3.4 Registry

| Job | Schedule | Handler in M1 |
| --- | --- | --- |
| `google-sync` | interval, 10 min | stub → `skipped`, "Ships in M4." |
| `approvals-deliver` | interval, 5 min | stub → `skipped`, "Ships in M8." |
| `daily-brief` | dailyAfter 06:30 | stub → `skipped`, "Ships in M9." |
| `learning-review` | weeklyAfter Sunday 18:00 | stub → `skipped`, "Ships in M7." |

Order in the registry is the order of execution.

---

## 4. `GET /api/cron/tick`

- Requires `Authorization: Bearer ${CRON_SECRET}`, compared in constant time. Missing or wrong →
  `401 { error: { code: "unauthorized", message: ... } }`. No `CRON_SECRET` configured →
  `503 { error: { code: "cron_not_configured", ... } }`, so a half-configured deployment says so
  instead of running unauthenticated.
- Added to `PUBLIC_PATHS` in `src/middleware.ts`: the route authenticates itself with the bearer
  and must be reachable without a session cookie.
- Runs due jobs **in sequence**. A job that fails is recorded and the next one still runs
  (PRD §9: a failed job never blocks the others in the same tick).
- Responds `200 { ran: [{ job, status, detail? }], skipped: [{ job, reason }] }`.
  `skipped` carries jobs that were not due this tick; a job whose handler returned `skipped`
  appears in `ran` with that status, because it did run.
- `dynamic = "force-dynamic"`, no caching.

**`vercel.json`:** `/api/cron/tick` every 5 minutes (`*/5 * * * *`). Vercel Hobby only allows
daily crons — the file carries a comment-free `crons` array plus a README note, and the plan gets
confirmed with Devon at deploy (M10). On Hobby the cadence becomes `0 11 * * *` and the "Sync now"
buttons in M4/M8 cover the gap.

---

## 5. Settings editors

All three live on `/settings`, each in its own `<section>` with its own form and its own inline
status message. Every server action calls `requireOwner()` (PRD §6.1) and returns the
`FormState` shape the existing forms already use.

### 5.1 Time zone

- `<select>` populated from `Intl.supportedValuesOf("timeZone")`, current value selected.
- The server action validates the submitted value against that same list before writing, so a
  forged POST cannot put junk in `settings.timezone`.
- Saving revalidates the layout: Command's "today", due windows and protected time all read it.

### 5.2 Protected time

- Up to 10 blocks. Each block: `label` (1–40 chars), `days` (one or more of Mon–Sun, stored
  1–7 with Monday = 1 as the schema comment says), `start` and `end` as `HH:MM`.
- Rendered as a list of existing blocks, each with its own Remove button, plus one Add form.
  Separate forms per row keeps an error on one block from discarding the others.
- Rejected with a message, no write: end ≤ start, no day ticked, blank label, 11th block,
  malformed time.
- Empty state: "No protected time yet. Blocks you add here are times the Operator will never
  book over."

### 5.3 Export my data

- `GET /api/export` behind the session (middleware + `currentOwner()` in the handler).
- Returns `{ exportedAt, timezone, tables: { <table>: rows[] } }` for every table in the schema,
  `Content-Disposition: attachment; filename="dscott-os-export-<YYYY-MM-DD>.json"`.
- **Never includes** `owner.password_hash` or `settings.encrypted_keys`. The column list is built
  by explicitly removing those two keys from the row objects, and a test asserts their absence by
  scanning the serialised output.

### 5.4 Job runs panel

- Last 10 runs per job, newest first, grouped by job, with status and duration. Jobs with no runs
  show "No runs yet."

---

## 6. Acceptance criteria

From PRD §8.1, plus what the spec adds:

1. **Crypto round-trip.** `decrypt(encrypt(s)) === s` for ASCII, Unicode and empty string. ✔ test
2. **Tamper fails.** Flipped ciphertext byte, swapped tag, truncated parts, missing section and a
   `v2:` prefix each throw. ✔ test
3. **Cron auth.** No header, wrong secret and a wrong-length secret all return 401 with
   `{ error: { code, message } }`. The right secret returns 200 with `ran`/`skipped` arrays. ✔ test
4. **Due logic.** `isJobDue` is covered for each kind: first run, inside the window, past the
   window, before/after the daily time, the right/wrong weekday, and across a DST boundary in
   `America/New_York`. ✔ test
5. **Failed job does not block the tick.** A registry where the first handler throws still runs
   the second, and the first is recorded `error`. ✔ test
6. **`runJob` never throws** and always writes exactly one row. ✔ test (PGlite `memory://`)
7. **Protected time saves and re-renders.** An invalid range (end ≤ start) shows an error and
   writes nothing. ✔ test on the validator + manual form flow
8. **Time zone saves** and an invalid zone is refused. ✔ test on the validator
9. **Export is valid JSON** containing every table and no `password_hash` or `encrypted_keys`
   key anywhere in the output. ✔ test
10. **`npm run check` is green** (typecheck, tests, production build).

---

## 7. Accepted trade-offs

- **`job_runs` growth.** Every tick that finds a job due writes a row, stub handlers included. At
  a 5-minute cron that is roughly 430 rows a day; on the Hobby daily cron, 4. The Settings query
  is indexed and bounded at 10 per job, so reads stay flat. Pruning is a v2 line item, recorded
  in the build log rather than built here.
- **Stub handlers over an empty registry.** Registering all four jobs now means M4 and M8 change
  one function instead of wiring a scheduler, and the `{ran, skipped}` contract is testable
  before any integration exists.
- **No `running` status.** Runs are recorded on completion. A crashed job leaves no row instead of
  a row that lies.
