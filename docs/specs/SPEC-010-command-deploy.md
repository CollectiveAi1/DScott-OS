# SPEC-010 · M10 Command complete + deploy

**Milestone:** M10 (PRD §8.10) · **Depends on:** M1–M9 · **Branch:** `m10-command-deploy`
**Status:** SHIPPED 2026-11-10

The last milestone of v1. Nothing new is invented here: every module already works, and M10 is
about the two places where that stops being true for Devon — **the screen he opens first**, and
**the machine it runs on**.

Command has been accreting a panel per milestone since M2, in the order the milestones happened
rather than the order a morning happens. M10 settles it. And the OS has never run anywhere but
this laptop, on an embedded database, with a cron that only fires when a browser asks it to.

The gate at the end of this is not a test suite. It is **a week of Devon's actual life**, in
sandbox, with real data.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | Command in its final order, eight sections | §8.10 |
| 2 | The brief collapsible on Command | §8.10 |
| 3 | Needs attention gains four sources | §8.10 |
| 4 | Today's schedule on Command | §8.10 |
| 5 | "Run now" per job in Settings | §8.1 |
| 6 | `vercel.json` set to the Hobby daily cron | §8.1 |
| 7 | `docs/runbook.md` | §8.10 |
| 8 | README deploy steps that match the runbook | §8.10 |

### Out of scope

- The deploy itself. Creating the Supabase and Vercel projects needs Devon's accounts and his
  credentials; §7 of the runbook is the handoff, and the build log records it as his step.
- Anything in v2. A week of sandbox use is the input to deciding what v2 is — guessing now
  would waste the week.

### Decided with Devon at DEFINE

**Vercel Hobby, one cron a day**, at `0 11 * * *` (06:00 America/New_York, just inside the
brief's "after 06:30" window on standard time and 07:00 on daylight time — see §5). Hobby allows
one run a day, and this config is also correct on Pro, so the plan can change later without a
code change. **"Run now" per job** is what makes a daily tick liveable.

---

## 2. Command, final

In this order, top to bottom:

| # | Section | Shown when |
| --- | --- | --- |
| 1 | Greeting and date | always |
| 2 | Quick capture | always |
| 3 | Four tiles | always |
| 4 | **Today's brief**, collapsible | always (with a "write it now" state) |
| 5 | Conflicts, next 14 days | when there are any |
| 6 | Needs attention | when there are any |
| 7 | Due this week | always |
| 8 | **Today's schedule** | always (with an empty state) |

**The order is the argument.** Tiles are the glance; the brief is the read; conflicts and needs
attention are the things that will cost Devon something if he does not see them, which is why
they sit above the lists rather than under them. The two lists are reference, and reference goes
last.

**The brief is collapsible, open by default**, remembered in the URL (`?brief=closed`) like every
other piece of state since M2. A `<details>` element, so it works with no JavaScript.

**The weekly learning review stays**, below today's schedule. It is not in the PRD's list of
eight because it did not exist when §8.10 was written; it arrived in M7. It is a once-a-week
read, so it belongs after the daily ones rather than in the middle of them.

### 2.1 Needs attention, complete

PRD §8.10 lists five sources. Two exist. Three are added:

| Source | Condition | Links to |
| --- | --- | --- |
| Broken Google connection | M4, already built | `/settings` |
| Untriaged Misc capture | older than 7 days, M2, already built | `/work` |
| **Failed approvals** | status `failed` | `/approvals?tab=failed` |
| **Failed jobs** | a job run with status `error` in the last 24 h | `/settings` |
| **Deals with no next step** | `nextStep` empty, or `nextStepDue` past | `/pipelines` |

Each row says what is wrong and what clears it. The section stays hidden when empty: a panel
that is always on screen stops being read.

**Ordering is by how much it costs to ignore**, not by source: a broken connection and a failed
approval first, then failed jobs, then stale captures and stale deals.

### 2.2 Today's schedule

Today's events, by start time, with arena, kind and local times — all-day first. Imported and
Google events included, because the point is what the day actually holds. Empty state says so
and links to `/schedule`.

---

## 3. Run now

Settings → Scheduled jobs gains a **Run now** button per job, which runs that one job through
`runJob` — the same path the cron takes, so a manual run is recorded in the history exactly like
a scheduled one, with the same `ok`/`error`/`skipped` semantics.

**It ignores the schedule.** A manual run is Devon saying "now", so the due check is skipped;
otherwise the button would do nothing for the rest of the day, which on a daily cron is the one
moment it matters.

`requireOwner()`, like every action. This is not a second cron route and is not reachable
without a session.

---

## 4. The runbook

`docs/runbook.md`, written for Devon at 7am with something broken, not for a developer reading
in order:

1. **What this is and where it runs** — Vercel, Supabase, the one cron.
2. **Every environment variable**: what it is, where it comes from, what breaks without it.
3. **Rotating each secret**, one at a time, with what signs out or stops working when you do.
4. **Restoring from an export** — the JSON from Settings, and what it does and does not carry
   (no password hash, no stored keys; those are rotated, not restored).
5. **Every Needs-attention row**: what it means, what clears it.
6. **When something is wrong**: `/api/health`, the job history, the three failure modes that
   have actually happened (a revoked Google grant, a failed delivery, a stuck row).
7. **First deploy**, as a checklist Devon can follow in one sitting.

---

## 5. The cron window, honestly

`daily-brief` runs "once after 06:30 local". A single daily cron at `0 11 * * *` is 06:00 ET in
winter and 07:00 ET in summer — so **in winter the 11:00 tick is before 06:30 and the brief
waits for the next day's tick**, which would mean no brief at all.

This is the kind of thing that works in July and silently stops in November, so it is fixed
rather than documented: the cron runs at `0 11 * * *` and **`daily-brief`'s window is widened to
"after 05:00 local"**. 06:00 and 07:00 both fall inside it, year round. The brief is about the
day ahead, so an earlier one is no worse.

---

## 6. Acceptance criteria

1. Command renders the eight sections in §2's order. ✔ test
2. The brief collapses and the state survives a reload (`?brief=closed`). ✔ browser
3. Needs attention shows a failed approval, a failed job within 24 h, and a deal with no next
   step — and hides each once cleared. ✔ test
4. A job run that failed 25 hours ago does **not** appear. ✔ test
5. Needs attention is hidden entirely when there is nothing in it. ✔ test
6. Today's schedule lists today's events in order, all-day first, with an empty state. ✔ test
7. **Run now** runs one job, records it, and works when the job is not due. ✔ test
8. Run now requires a session. ✔ test
9. `daily-brief` is due at 06:00 and at 07:00 local. ✔ test
10. `vercel.json` is the daily schedule. ✔ test
11. `npm run check` is green.

---

## 7. Accepted trade-offs

- **One cron a day.** On Hobby it is the only option, and Run now covers the gap. When a real
  delivery provider exists (v2), the plan has to change — the runbook says so.
- **The brief's window widened rather than the cron moved.** A cron at 12:00 UTC would be 07:00
  and 08:00 — later than Devon wants the brief. Widening the window costs nothing.
- **Needs attention counts deals with no next step as one row each.** Five stalled deals is five
  rows. That is the point: the pipeline discipline is per deal.
- **No deploy automation.** A one-owner instance deployed once does not need a pipeline; it
  needs a checklist that is right.

---

## 8. Changed during BUILD

### The weekly review moved to the end, not the middle

§2 put it below today's schedule and that is where it is. Worth recording that it is a
deliberate departure from PRD §8.10's list of eight rather than an oversight: the review did not
exist when §8.10 was written, and a once-a-week read does not belong among the daily ones.

### Failed jobs are one row per job, not per run

`approvals-deliver` fails on every tick while no provider is connected. Twelve identical rows
would bury the other four sources, so the panel shows the most recent failure of each job.

### A next step with no due date is not "overdue"

`stalledDeals` flags an empty next step, and a dated one whose date has passed. A next step with
no date at all is undated, not late — that is Devon's call to make, and inventing a deadline for
him would be the OS nagging about a rule nobody set.

### Conflicts proved the hide-when-empty behaviour for free

The browser pass ran on a day with no clashes, so the Conflicts section was absent from the
rendered page while Needs attention was present. That is the same guard, on the same screen,
demonstrated rather than asserted.
