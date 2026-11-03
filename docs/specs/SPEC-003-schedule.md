# SPEC-003 · M3 Schedule

**Milestone:** M3 (PRD §8.3) · **Depends on:** M1 · **Branch:** `m3-schedule`
**Status:** SHIPPED 2026-11-02

One calendar for four arenas. This is the module the PRD's first differentiator rests on — "a
game that collides with a client call or a family event is caught before it becomes a problem" —
so the conflict rule is the centre of it, and everything else exists to show the result.

It is also the milestone where time zones stop being a detail. Every instant in the database is
`timestamptz`; every grid, every overlap and every "those days" is reasoned about in
`settings.timezone`. M4 (Google sync) and M5 (basketball import) both write into the table this
milestone defines the semantics for, so the storage rules here are load-bearing.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | Zone-correct date maths: local wall time ↔ instant, day/week/month grids | §8.3, §6.1 |
| 2 | `conflict_acks` table | §6.2 |
| 3 | The conflict rule as a pure, unit-tested function | §8.3 |
| 4 | `/schedule` with Agenda, Week, Day and Month views | §8.3 |
| 5 | Manual events: create, edit, delete with confirm | §8.3 |
| 6 | Protected time as hatched background in Week and Day | §8.3 |
| 7 | Conflict badges on both events, and Acknowledge | §8.3 |
| 8 | Command → Conflicts, next 14 days | §8.3 |
| 9 | Imported and Google events read-only except notes | §8.3 |
| 10 | "Make event" in the Misc inbox, prefilled — the control M2 shipped disabled | §8.2 |

### Out of scope

- Google and import *sources*. M4 and M5 create those rows; M3 defines how a row from either one
  behaves once it exists, and is tested with rows written directly.
- Recurring events. Nothing in v1 creates one: Google sync expands instances (§8.4) and the
  importer writes individual rows (§8.5). Protected time is the only recurring thing, and it is
  a settings rule, not an event.
- Drag to move or resize. Editing is a form, as everywhere else in v1.

---

## 2. How an event is stored

These rules are the contract M4 and M5 write against.

- **Instants, always.** `starts_at` and `ends_at` are `timestamptz`. The wall-clock time Devon
  typed is reconstructed by rendering in `settings.timezone`, never stored separately.
- **Half-open intervals: `[start, end)`.** A 10:00–11:00 meeting and an 11:00–12:00 call do not
  overlap. Every comparison in this module follows that, and it is what makes back-to-back
  scheduling work.
- **All-day is midnight to midnight, exclusive.** An all-day event on Nov 5 is stored
  `starts_at` = Nov 5 00:00 local, `ends_at` = Nov 6 00:00 local. Nov 5–7 ends at Nov 8 00:00.
  This matches Google's `start.date`/`end.date`, so M4's mapping is a copy rather than a
  conversion.
- **Travel is all-day and multi-day by default**, departure through return.
- An event must end after it starts. Equal is refused: a zero-length event is a mistake.

### Local wall time → instant

`zonedTimeToInstant(date, time, zone)` guesses the instant as if the wall time were UTC, measures
the zone's offset at that guess, applies it, and re-measures once in case the correction crossed
a DST boundary. Two passes is enough for every real zone.

Two days a year are not one-to-one with wall time, and the spec takes a position on both:

- **Spring forward** — 02:30 on the second Sunday in March does not exist in `America/New_York`.
  The function returns the instant the clock jumps to (03:30 EDT). An event cannot be saved into
  a time that does not exist, so it lands immediately after the gap.
- **Fall back** — 01:30 on the first Sunday in November happens twice. The function returns the
  first (EDT). Picking a side consistently matters more than which side.

---

## 3. The conflict rule (`src/modules/schedule/conflicts.ts`)

Pure. Takes two events, or an event and a protected-time block, and answers yes or no. No
database, no clock.

| # | Rule | Result |
| --- | --- | --- |
| 1 | Intervals do not overlap | no conflict |
| 2 | Both events are all-day | no conflict |
| 3 | Both events are in the **basketball** arena | no conflict — a practice inside a team event is normal |
| 4 | An all-day **travel** event vs a timed event in another arena | conflict |
| 5 | Any other overlap where at least one is not all-day | conflict |
| 6 | A timed event overlapping a protected-time block on that weekday | conflict |

Rule 3 is basketball only: two Collective meetings double-booked is exactly the thing Devon
wants caught.

Rule 6 compares a timed event against each local day it touches, because a block is a weekly
rule (`days`, `start`, `end`) rather than a row with instants. An all-day event does not trip
protected time — it is not occupying the hours.

### A flagged consequence of rule 5

Taken literally, rule 5 means **any** all-day event conflicts with **every** timed event that
overlaps it, not just travel. An all-day "Maya's birthday" would therefore conflict with each of
that day's meetings.

That is what §8.3 says, so that is what M3 builds. But M4 syncs the Family calendar out of
Gmail, where all-day entries are the common case — birthdays, holidays, school closures — and on
the first sync this rule will turn one all-day row into a conflict against every timed event
that day. The point of the panel is that a conflict means something.

The rule is written so the fix is one line (`rule 5 applies when the all-day side is travel`),
and the question goes to Devon at the M4 gate with real data in front of him rather than being
decided unilaterally here. Recorded in the build log as an open question, not a defect.

### Acknowledgement

`conflict_acks` stores a pair of event ids, canonically ordered so the smaller id is always
`event_a_id`. That makes the unique index do the work: one ack per pair regardless of which
event Devon was looking at.

Editing an event's **time** clears every ack mentioning it, so a resolved-then-broken conflict
comes back. Editing a title or notes does not. Protected-time conflicts cannot be acknowledged —
there is no second event id to key on — and they are shown as a warning on the event itself.

---

## 4. `/schedule`

URL state, as in M2: `?view=agenda|week|day|month&date=YYYY-MM-DD&event=<id>`.

**With no `view`**, the page renders Agenda and Week and lets CSS choose — Agenda under `md`,
Week at `md` and up. That is the PRD's "Agenda default on phones, Week default on desktop"
without a viewport guess on the server, without JS, and without a flash. An explicit `view`
renders only that one.

| View | Shape |
| --- | --- |
| Agenda | The next 14 days as a list, grouped by day, all-day events first |
| Day | One column, 24 h, 30-minute rows, protected time hatched behind |
| Week | Seven columns, Monday first, same grid |
| Month | A 6-week grid, always 42 cells, from the Monday on or before the 1st |

- Events are coloured by arena and every one carries its arena label: colour is never the only
  signal (§8.0).
- Overlapping timed events in one day column are laid out side by side within their overlap
  cluster, so neither hides the other.
- A conflicting event shows a badge on **both** sides of the conflict.
- Imported and Google events show where they came from and offer only a notes field.
- Month cells show up to three events and "+N more", linking to that Day.

Week starts Monday, matching protected time's `days` (Monday = 1) and everything else in the OS.

---

## 5. The event form

`/schedule/new` and `/schedule/<id>`. Fields: title, arena, kind, all-day, start date, start
time, end date, end time, location, notes.

- **Kinds follow the arena.** Basketball offers practice, S&C, team event, game, travel;
  the other arenas offer deadline and other, and Family also offers family.
- **Travel selects all-day** and defaults the end date to the start date, for departure through
  return.
- All-day hides the time fields; the dates are inclusive in the form and stored exclusive.
- Delete arms on the first press and deletes on the second, as in M2.
- An event from Google or an import renders its fields read-only with a line saying which, and
  saves only notes.
- `?title=` and `?from=<taskId>` prefill it. Saving an event made from a capture completes that
  capture: turning it into an event *is* triaging it, and the form says so before saving.

---

## 6. Command

A **Conflicts** panel above Needs attention: unacknowledged conflicts in the next 14 days, each
showing both titles and times, with Acknowledge. Protected-time conflicts appear in the same
panel, marked, without an Acknowledge button.

---

## 7. Schema

| Table | Columns |
| --- | --- |
| `conflict_acks` | `id` uuid pk, `event_a_id` → calendar_events cascade, `event_b_id` → calendar_events cascade, stamps |

Indexes: both foreign keys, and `unique (event_a_id, event_b_id)` with the pair stored in
canonical order.

---

## 8. Acceptance criteria

1. **The PRD's example.** A Collective meeting at the same time as a game appears in Command →
   Conflicts with both titles and times. ✔ test
2. **Acknowledging hides the pair**, and editing either event's time brings it back. ✔ test
3. **Month view is a 6-week grid**, correct across month ends, a 28-day February, a leap
   February, and both DST boundaries in `America/New_York`. ✔ test
4. **The conflict rule** is covered for every row of the table in §3, including: back-to-back
   events do not conflict; two all-day events do not; two basketball events do not; basketball
   travel does conflict with a timed Collective meeting; two Collective meetings do conflict; a
   timed event inside protected time does; an all-day event does not trip protected time. ✔ test
5. **Zone maths.** Wall time round-trips through an instant in `America/New_York` and in a
   zone with no DST; the spring-forward gap and the fall-back repeat behave as §2 states; a
   week grid crossing a DST boundary still has exactly 7 days and a month grid 42. ✔ test
6. **All-day storage** is midnight-to-exclusive-midnight, and a one-day all-day event does not
   bleed into the next day in any view. ✔ test
7. **Read-only sources.** Saving a Google or import event writes notes and nothing else, even if
   other fields are posted. ✔ test
8. **Travel** defaults to all-day and spans departure through return. ✔ test
9. **An event made from a capture** completes that capture. ✔ test
10. Every mutation calls `requireOwner()` and returns a `FormState`; no raw DB errors on screen.
11. No horizontal overflow at 375 px in any view.
12. **`npm run check` is green.**

---

## 9. Accepted trade-offs

- **Both Agenda and Week in the DOM when no view is chosen.** A few extra elements buys the
  PRD's per-device default with no JS, no server-side viewport guess and no layout flash.
- **A 24-hour grid rather than a working-hours window.** Basketball practices and travel do not
  sit inside 9–5, and a grid that hides half the day hides conflicts. The grid scrolls, and
  opens scrolled to 07:00.
- **Protected-time conflicts cannot be acknowledged.** The ack table keys on two event ids. A
  protected block is a settings rule, and the honest fix for an event inside one is to move the
  event or change the block.
- **No overlap-aware layout in Month.** Month cells list events; the grid is for orientation,
  and Week and Day are where overlap is read.

---

## 10. Changed during BUILD

Recorded here rather than left in the diff, per the REVIEW gate in `docs/CONTEXT.md`.

### Form parsing moved out of `actions.ts`

The browser pass found two bugs in the same place: an unchecked all-day box and the hidden time
inputs send **no field at all**, not an empty one, and the schema treated a missing key as a
failure. Worse, it surfaced as "Invalid input: expected nonoptional, received undefined" on
screen — a zod message, written for a developer, in front of Devon, which §6.1 forbids outright.

The schema and its error mapping now live in `src/modules/schedule/form-schema.ts` with their own
tests, including one that asserts no raw zod wording can reach the screen for any missing field.
Parsing a form is a rule, and rules in this codebase are pure and tested.

### `scroll-to-hour.tsx`

A 24-hour grid opens at midnight. No CSS sets a scroll container's initial position, and hiding
the small hours would hide conflicts, so a six-line client component scrolls the grid to 07:00 on
mount.

### Query tests live with the service tests

`tests/schedule.queries.test.ts` is not a separate file. The service tests read their results
back through the queries, so splitting them would have duplicated the fixtures.

### The React form-reset trap, a third time

M1 found it on a text field, M2 on checkboxes and a select, and M3 on the event form's arena and
kind selects: after a refused submit the selects reverted while React's own tree still held the
chosen values, so the **next** submit would have posted the wrong arena. The general rule, now
proven three times and worth stating once:

> Any control React cannot diff back into place — checkbox, radio, select — must be remounted
> when a form action settles. Text inputs and textareas re-apply their value on their own.

Every such control in this module is keyed on a submit counter.
