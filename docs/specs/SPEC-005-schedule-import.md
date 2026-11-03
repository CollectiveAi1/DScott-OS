# SPEC-005 · M5 Basketball schedule import

**Milestone:** M5 (PRD §8.5) · **Depends on:** M3 · **Branch:** `m5-schedule-import`
**Status:** SHIPPED 2026-11-03

The official team schedule has not arrived. This milestone builds the thing that will swallow it
the day it does — a CSV, a pasted block of text, or the PDF the coach actually sends — and turns
it into basketball events that sit on the same calendar as everything else.

Two properties matter more than any feature here:

- **Nothing is written until Devon has seen exactly what will change.** Every import is a preview
  first and a write second.
- **Importing the same file twice changes nothing.** Identity comes from the content, so a
  re-run is a no-op rather than a duplicate season.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | `/schedule/import`: CSV upload, or CSV/TSV pasted as text | §8.5 |
| 2 | A deterministic parser with per-row errors carrying line numbers | §8.5 |
| 3 | Free text, PDF or image through the model, when a key exists | §8.5 |
| 4 | Preview: new, changed, unchanged, will be removed | §8.5 |
| 5 | Idempotent upsert with a content-derived `externalId` and a batch id | §8.5 |
| 6 | Removal of future events dropped from a later import, after confirming | §8.5 |
| 7 | `docs/samples/basketball-schedule.csv` | §8.5 |
| 8 | `calendar_events.import_batch` | §6.2 |

### Out of scope

- Importing into any arena but Basketball. The whole feature exists for the team schedule;
  a generic importer is not something anyone has asked for.
- Editing rows inside the preview. A wrong row is fixed in the source and re-previewed, or
  fixed on the event afterwards. An editable preview is a spreadsheet, and Devon already has one.

---

## 2. The CSV

Columns, case-insensitive, spaces or underscores either way:
`date, start, end, type, title, location, notes` — plus `end_date` for travel.

| Field | Accepts |
| --- | --- |
| `date` | `2026-11-07`, `11/7/2026`, `11/7/26` |
| `start` | `18:00`, `6:00 PM`, `6pm`. Empty only for travel |
| `end` | the same, or empty |
| `end_date` | a date; travel only |
| `type` | practice, s&c, team event, game, travel — plus the obvious spellings (`s and c`, `strength`, `team_event`) |
| `title` | required |
| `location`, `notes` | free text |

- **Delimiter is detected**, comma or tab, by which one the header line actually contains.
- Quoted fields are handled properly: a title containing a comma, or a quoted newline, survives.
- **A missing end** becomes start + 2 h for a game and start + 90 min otherwise, and the preview
  says so on that row. It is an assumption, so it is shown as one.
- **Travel is all-day**, `date` through `end_date` (or a single day when `end_date` is absent),
  stored with M3's exclusive end.
- Times and dates resolve in `settings.timezone`.
- **A bad row never stops the file.** It is listed with its line number and a plain reason, and
  the rest import once Devon confirms.

---

## 3. Identity, and what counts as a change

`externalId = sha256(date | start | type | title)`, normalised: the date as `YYYY-MM-DD`, the
start as `HH:MM` (empty for all-day), the type as its stored kind, the title trimmed,
case-folded and inner whitespace collapsed. This is PRD §8.5's formula, and it is what makes a
re-import a no-op.

It has one consequence worth naming: **the time is part of the identity**, so moving a practice
from 17:00 to 18:00 produces a different id. Left alone, that would show as one event added and
one removed.

It is presented and written as a **move** instead. When an incoming row has no matching id, and
exactly one about-to-be-removed row shares its date, type and title, the two are paired: the
existing row is updated in place — new time, new id — rather than deleted and recreated. The
pairing is only made when it is unambiguous on both sides; two practices with the same name on
the same day fall back to add-and-remove, because guessing which one moved would be worse than
saying so.

This satisfies PRD §8.5's "editing one row's time and re-importing updates exactly one event"
without departing from the specified hash, and it keeps the event's id, its notes and any
conflict acknowledgements attached to it.

---

## 4. The preview

Parse, compare, show, then confirm. Nothing is written before Confirm.

| Group | Meaning |
| --- | --- |
| New | No existing row matches |
| Changed | Matched by id with different fields, or paired as a move |
| Unchanged | Matched by id, identical |
| Will be removed | A **future** event from an earlier import that this file no longer contains |
| Errors | Per row, with its line number and a plain reason. Not imported |

- **Removal only ever reaches future events.** A past game that fell out of a revised schedule
  stays: it happened, and the record of it is worth more than tidiness.
- Assumed end times are flagged on the row that assumed them.
- Confirm re-parses the same source text rather than trusting a round-tripped plan. The parser is
  deterministic, so the preview Devon approved is the import he gets, and there is no half-built
  import sitting in the database waiting to go stale.

---

## 5. Text, PDF and image

Only when `ANTHROPIC_API_KEY` is set. Without it the option renders disabled with one line
saying why — the pattern M2 used for "Make event" before M3 existed.

- One call, with a strict JSON schema:
  `{ events: [{ date, start?, end?, endDate?, type, title, location?, notes? }] }`.
- The result is validated with zod, **row by row**. A row that fails validation is listed as an
  error with what was wrong. Nothing is dropped silently.
- Validated rows then go through exactly the same pipeline as CSV rows: the same defaults, the
  same identity, the same preview. The model is a parser, not a second code path.
- **The document is data, not instructions** (PRD §6.3). The prompt says so, and the model is
  given no tools, so the worst a hostile PDF can do is produce rows Devon sees in a preview and
  declines.
- The model client is injected, so the pipeline is tested without a key and without a network
  call.

**Correction to the PRD.** §6 names `claude-sonnet-5-5` and `claude-haiku-5-5`. Those model ids
do not exist. This ships `claude-sonnet-5`, overridable with `OPERATOR_MODEL`, and the README
records the correction.

---

## 6. Schema

| Change | Detail |
| --- | --- |
| `calendar_events.import_batch text` | The id of the import that last wrote this row |

Indexed with `source` for the preview's "what did earlier imports leave" query.

---

## 7. Acceptance criteria

1. **The sample CSV imports its N rows**; importing it again reports everything unchanged and
   writes nothing new. ✔ test
2. **Editing one row's time and re-importing updates exactly one event** — same row id, new
   time, nothing added or removed. ✔ test
3. **A malformed row is reported with its line number**, and the rest import after confirm. ✔ test
4. **With no model key**, the text/PDF option is disabled with a one-line reason. ✔ test
5. **Quoted fields** with commas and newlines parse correctly; tabs work as well as commas. ✔ test
6. **A missing end** becomes +2 h for a game and +90 min otherwise, and is flagged as assumed. ✔ test
7. **Travel** becomes an all-day span from `date` through `end_date` inclusive, stored exclusive. ✔ test
8. **Removal touches only future events**, and only after Confirm. ✔ test
9. **Model output is validated row by row**; an invalid row is an error, not a silent drop. ✔ test
10. **Times resolve in the settings time zone**, not the server's. ✔ test
11. Every mutation calls `requireOwner()`; no raw errors reach the screen.
12. **`npm run check` is green.**

---

## 8. Accepted trade-offs

- **Confirm re-parses instead of storing a plan.** One source of truth, no pending-import table,
  no stale plan. The cost is parsing twice, which is microseconds.
- **The preview is read-only.** Fixing rows in place would mean building a spreadsheet; the
  source file is already one.
- **A hand-written CSV reader.** RFC 4180 quoting is about forty lines and the stack (§6) does
  not carry a CSV dependency. Fully tested, and it fails loudly rather than guessing.
- **Only Basketball.** Written into the service, not the UI, so it cannot be widened by accident.

---

## 9. Changed during BUILD

### One row interpreter, shared

`parse.ts` grew an `interpretRow` that both the CSV reader and the model parser call. The spec
promised "the model is a parser, not a second code path"; extracting the rules was what made
that true rather than aspirational. A document and a spreadsheet now get the same defaults, the
same types and the same error messages.

### Notes are never overwritten by a re-import

The CSV carries a notes column, but `notes` is also the one field Devon can edit on an imported
event (SPEC-003 §4). Writing it on every import would quietly erase what he typed, the same trap
M4 avoided with Google's `description`. Notes are written when a row is created and left alone
after that. Tested.

### An unchanged row is not touched at all

Re-importing the same file does not stamp a new batch id or bump `updated_at` on rows that did
not change. "A re-import is a no-op" reads better as the literal truth than as a near-truth, and
a test asserts the timestamps are identical.

### `serverActions.bodySizeLimit`

A PDF posted through a server action hits Next's 1 MB default. Raised to 8 MB in
`next.config.ts`, with the importer refusing anything larger itself and saying the actual size.
