# SPEC-007 · M7 Learning

**Milestone:** M7 (PRD §8.7) · **Depends on:** M1 · **Branch:** `m7-learning`
**Status:** SHIPPED 2026-11-04

The one module that is only about Devon. Everything else in the OS tracks obligations to other
people; this tracks whether he is actually getting better at anything, which is the problem
statement's quietest line: *"I'm trying to grow my own skills and have no record of what I'm
actually putting time into."*

It is also the first module that **writes something to read later** — a weekly review, generated
on a schedule into `digests`. M9's daily brief uses the same table and the same offline-first
shape, so the decisions here carry.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | `/learning`: skills with current → target and minutes over 7 and 30 days | §8.7 |
| 2 | Skill page: learning items, and a practice log with quick-log buttons | §8.7 |
| 3 | The weekly review, computed as data | §8.7 |
| 4 | A deterministic offline template, and a model summary when a key exists | §8.7 |
| 5 | The `learning-review` job body, replacing M1's stub | §8.1 |
| 6 | The review at the top of `/learning`, linked from Command | §8.7 |
| 7 | `digests` | §6.2 |

### Out of scope

- Importing anything from a course platform. There is no integration to import from, and the
  point is the record Devon keeps, not one somebody else keeps for him.
- Reminders or nudges. A review that arrives weekly is the nudge; anything more becomes noise
  he turns off.

---

## 2. Skills and practice

A skill carries a current level, a target level (1–5), and why it matters. The list shows the
levels and **minutes in the last 7 and 30 days**, because the number that tells the truth about
a skill is time spent, not a level somebody assigned themselves.

Practice is logged by day, in minutes, with an optional note. **Quick-log buttons for 15, 30 and
60 minutes** against today: the whole feature fails if logging practice takes longer than the
practice felt worth. A fuller form covers a different day or an odd number of minutes.

Logging is additive. Two sessions on one day are two rows, not an overwrite — a day's total is
their sum.

Learning items are what the practice is *on*: a course, a book, a video or a project, each with
a status (queued, active, done, dropped), a due date and a URL.

---

## 3. The weekly review

### Computed as data first

`buildReview(input) → LearningReview` is pure: skills, items, practice rows and a date in, a
structured review out. No clock, no database, no prose. Everything downstream — the offline
template, the model prompt, the screen — reads that one structure.

| Section | Rule |
| --- | --- |
| Minutes per skill | This week against last week, as Monday–Sunday blocks containing the review day |
| Stalled | An **active** item whose skill has no practice in 14 days |
| Past due | An item with a due date before today, not done and not dropped |
| Next step | Exactly one per skill, from the ladder below |

**The next-step ladder**, first match wins:

1. An item is past due → "Finish *x*, it was due *date*."
2. An item is active but its skill is stalled → "Get back to *x*."
3. An item is active → "Keep going on *x*."
4. An item is queued → "Start *x*."
5. The skill has items, all done or dropped → "Pick something new for *skill*."
6. The skill has no items → "Add something to learn for *skill*."

One step, not a list. A review that hands back six things to do is a backlog, and backlogs are
what the rest of the OS is for.

### Written twice

- **Offline, always available.** A deterministic template renders the structure into text.
  Same data in, same words out, which is what makes it testable — and PRD §8.7 asks for exactly
  that.
- **With a key**, `SUMMARY_MODEL` rewrites the same structure more readably. The computed data
  is handed to the model; the model does not go looking. If the call fails, the offline text is
  what gets stored, and the digest records which wrote it.

**The numbers are never the model's.** Minutes, counts and dates are computed and interpolated;
the model is given them already resolved and asked only to phrase them. A summary that invents a
total is worse than a plain one.

### Stored, not recomputed

One `digests` row, `kind = learning_review`, keyed by day. Unique on `(kind, day)`, so a job
that runs twice on a Sunday — a retry, a manual run, a second tick — updates one row rather than
accumulating.

### Run

The `learning-review` job (Sundays after 18:00 local, registered in M1) writes it. A **Write it
now** button does the same thing on demand: the job runs once a week, and a feature nobody can
see until Sunday is a feature nobody trusts.

---

## 4. Schema

| Table | Columns |
| --- | --- |
| `digests` | `id` uuid pk, `kind` enum (`daily_brief`, `learning_review`), `day` date, `body` text, `created_by`, stamps |

Unique on `(kind, day)`. `daily_brief` is in the enum from the start so M9 adds no migration.

**Added beyond §6.2's list:** `digests.source` — `offline` or `model` — so the screen can say
which wrote it, and `digests.data jsonb`, the computed structure the body was rendered from. The
text is for reading; the data is what a later milestone can re-render or chart without
re-deriving anything.

---

## 5. Acceptance criteria

1. **Logging 30 minutes today updates the 7-day total immediately.** ✔ test
2. **The offline review is deterministic**: the same fixed data produces the same text, twice.
   ✔ test
3. **Minutes per skill compare this week against last week**, on Monday–Sunday boundaries in the
   settings time zone. ✔ test
4. **Stalled** catches an active item whose skill has no practice for 14 days, and leaves alone
   one practised 13 days ago. ✔ test
5. **Past due** catches an overdue item and ignores one already done or dropped. ✔ test
6. **One next step per skill**, following the ladder in §3. ✔ test
7. **Two sessions on one day sum**, rather than one replacing the other. ✔ test
8. **Running the review twice on one day updates one row**, and does not accumulate. ✔ test
9. **With no model key the offline text is stored** and the digest says so. ✔ test
10. **A model failure falls back to the offline text** rather than storing nothing. ✔ test
11. `npm run check` is green.

---

## 6. Accepted trade-offs

- **Levels are self-assessed and unvalidated.** The minutes are the honest number; the level is a
  label Devon moves when it feels true.
- **The review stores text, not a render-on-read.** A review is a record of what was true that
  Sunday. Recomputing it later would quietly rewrite history.
- **Weeks are Monday–Sunday**, matching protected time and M3's grids. The review lands Sunday
  evening, so "this week" is the week just finished.

---

## 7. Changed during BUILD

### A second model-id correction

M5 recorded that PRD §6's `claude-sonnet-5-5` does not exist. The same is true of
`claude-haiku-5-5`, which §6 names for `SUMMARY_MODEL`. The real small model is
`claude-haiku-4-5-20251001`, and that is the default here, still overridable by env. Both
corrections are now in the README; **the PRD itself is still wrong and should be fixed before
M9 builds the Operator on those lines.**

### The job handler is tested, not just the service under it

A service that works behind a handler nobody exercised is a milestone that ships broken wiring.
`tests/learning.service.test.ts` now runs the registered `learning-review` definition through
`runJob` with a Sunday-evening clock, and asserts the schedule is only due on a Sunday after
18:00.

### "Write it now"

Not in §8.7, added anyway. The job runs once a week, and a feature nobody can see until Sunday
is a feature nobody trusts — the same reasoning that put "Sync now" beside the Google job in M4.
