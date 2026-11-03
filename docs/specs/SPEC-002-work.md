# SPEC-002 · M2 Work + Misc capture

**Milestone:** M2 (PRD §8.2) · **Depends on:** M1 · **Branch:** `m2-work` (stacked on `m1-foundations`)
**Status:** SHIPPED 2026-11-02

M2 is the first module Devon actually uses all day. It gives every stray thought a one-second home
and turns the pile into work he can sort: capture on Command and on his phone, a Misc inbox that
has to reach empty, a Work screen with a board and a list, projects, and a task drawer.

M1 made the floor. This is the first room on it, and it sets the pattern every later module
copies: `src/modules/<module>/{queries,service,actions,capture}.ts` plus server-rendered screens
whose whole state lives in the URL.

---

## 1. Scope

| # | Deliverable | PRD |
| --- | --- | --- |
| 1 | Capture parser: arena, priority and due tokens, stripped from the title | §8.2 |
| 2 | Quick capture on Command and in a phone bottom bar | §8.2, §9 |
| 3 | Misc inbox at the top of `/work`: triage, done, delete | §8.2 |
| 4 | `/work` board view and list view with filters | §8.2 |
| 5 | Move between columns, complete a task | §8.2 |
| 6 | `/work/projects`: name, owner, due, status, done/total | §8.2 |
| 7 | Task detail drawer | §8.2 |
| 8 | Command → Needs attention: captures untriaged over 7 days | §8.2 |
| 9 | `tasks.notes` column | §6.2 |
| 10 | Arena colour tokens and an arena tag that always carries a label | §8.0 |
| 11 | Mobile nav: sidebar collapses to a top bar with a menu button | §8.0, §9 |

### Out of scope, and why

- **"Make event" from the Misc inbox.** The event form ships with M3; there is nothing to prefill
  yet. The control renders disabled with a one-line reason, the way M5 disables model parsing
  without a key — not hidden, and never a dead link.
- **Contact and deal links on a task.** M6 creates the first contact or deal. The drawer *shows*
  them when set and offers no picker for empty tables; the project picker works today.
- **The rest of Command.** M10 completes it. M2 adds the quick-capture box and a Needs-attention
  panel shaped to take more item kinds later.
- Drag and drop. The PRD calls it optional sugar; "Move to…" is keyboard-first and ships instead.

---

## 2. Capture parser (`src/modules/work/capture.ts`)

```
parseCapture(input: string, today: string): ParsedCapture | { error }
```

Pure, given today's date in the settings time zone. One line in, a task out.

| Token | Accepts | Result |
| --- | --- | --- |
| arena | `#collective` `#basketball` `#family` `#misc` | sets arena, default `misc` |
| priority | `!urgent` `!high` `!normal` `!low` | sets priority, default `normal` |
| due | `due:YYYY-MM-DD`, `due:today`, `due:tomorrow`, `due:mon`…`due:sun` | sets due date |

Rules:

- **Case-insensitive**, and a token is recognised anywhere in the line, not only at the end.
- **Recognised tokens are stripped** from the title; the remaining whitespace is collapsed.
- **A weekday resolves to its next occurrence including today.** `due:mon` typed on a Monday means
  today, so it agrees with `due:today` instead of quietly meaning eight days out.
- **The last token of a kind wins**, so correcting yourself mid-line works.
- **Anything unrecognised stays in the title.** `#kinetic`, `!!`, `due:whenever` are left exactly
  where they were. A quick capture must never lose the thought, and a token that survives into
  the title is visible proof it was not understood.
- A line that is empty, or empty once tokens are stripped, is an error: "Type something to capture."
- Titles are capped at 200 characters.
- The task is written with `arena` as parsed, `fromMisc = true` and `status = open`. Even a capture
  tagged `#basketball` lands in the inbox: the tag says where it belongs, triage says it is sorted.

**Acceptance (PRD):** `Call coach re: film session #basketball !high due:tomorrow` gives
`{ title: "Call coach re: film session", arena: "basketball", priority: "high", due: <tomorrow in settings tz> }`.

---

## 3. Misc inbox

At the top of `/work`, oldest first, only `fromMisc = true` and `status = open`.

| Action | Effect |
| --- | --- |
| Make task | Form: arena, board, column, due, priority. Clears `fromMisc`. |
| Make event | Disabled, "Events arrive with Schedule (M3)." |
| Done | `status = done`, `completedAt = now`, clears `fromMisc`. |
| Delete | Removes the row. Two-step: the button arms, a second click confirms. |

Empty state: "Inbox clear. Anything you capture lands here until you sort it."

The count is shown in the heading, because the goal (PRD §11) is that nothing sits here over a week.

---

## 4. `/work`

All state lives in the URL, so every view is a server render, shareable and back-button-correct:
`?view=board|list&board=<id>&arena=&priority=&due=&status=&task=<id>`.

### Board view (default)

- Columns come from `boards.columns` for the selected board; the board is chosen with a picker.
- A task on the board with no column, or a column no longer on the board, is grouped first under
  **Unsorted** — nothing a board holds is ever invisible.
- Each card: title, arena tag, due (marked overdue), priority when above normal, project.
- Per card: **Move to…** (a disclosure holding one submit button per other column — native
  keyboard support, no JS) and **Complete**.

### List view

- Every task matching the filters, board or no board, newest due first with undated last.
- Same per-row actions.

### Filters

| Filter | Values |
| --- | --- |
| arena | any, collective, basketball, family, misc |
| priority | any, urgent, high, normal, low |
| due | any, overdue, today, this week, no date |
| status | open (default), done, any |

Filters submit with a real GET form. "Clear filters" appears only when something is set.

### Task drawer

`?task=<id>` renders an aside next to the list. Editable: title, notes, due, priority, owner,
arena, board, column, project. Shown when set, not editable yet: contact, deal (M6). Closing is a
link back to the same view without `task`.

---

## 5. `/work/projects`

Name, owner, due, status (active, paused, done), and done/total of its linked tasks as a count and
a bar. Create and status change are here too: nothing else in v1 creates a project, and a screen
that can only ever be empty is not a screen.

---

## 6. Command additions

- **Quick capture** directly under the greeting, the first thing on the page.
- **Needs attention**: items that have gone stale. M2 supplies one kind — a capture untriaged for
  more than 7 days — through a list shaped to take M4's broken connection and M6's missing next
  step without changing the panel.
- The existing "Due this week" list gets its placeholder copy corrected now that Work exists.

---

## 7. Shared UI (PRD §8.0)

- Arena tokens in `@theme`: collective `#d4a843`, basketball `#4fa3e0`, family `#7cc49a`,
  misc `#8b9bae`. An `<ArenaTag>` renders the colour **and** the label, always — colour is never
  the only signal.
- Sidebar becomes a top bar with a menu button under `md`, so Work is usable at 375 px. The
  quick-capture bar is fixed to the bottom on phones: one tap from anywhere.
- Work's sidebar entry turns from its `v1` tag into a link.

---

## 8. Schema

| Change | Detail |
| --- | --- |
| `tasks.notes text` | Free-text detail, per PRD §6.2 |
| `tasks_misc_idx` | `(from_misc, created_at)` — the Misc inbox query |
| `tasks_arena_status_idx` | `(arena, status)` — the most common Work filter pair |
| `boards.position integer default 0` | **Added during BUILD** (see §11) — display order |

No new foreign keys. Existing `tasks_open_due_idx (status, due)` already serves the due filters.

---

## 9. Acceptance criteria

1. **The PRD's capture line** parses exactly as §8.2 states. ✔ test
2. **Every token** is covered: each arena, each priority, each `due:` form, tokens mid-line,
   mixed case, repeated tokens, unknown tokens left in place, empty input refused. ✔ test
3. **Weekday resolution** is correct from each day of the week, including today's own weekday,
   and across a month boundary. ✔ test
4. **A capture untriaged for more than 7 days** appears in Command → Needs attention; one from
   six days ago does not. ✔ test
5. **Completing a task** sets `status = done` and `completedAt`, and it leaves Command's due
   list. ✔ test
6. **Triage** clears `fromMisc` and writes the chosen arena, board, column, due and priority;
   the item leaves the inbox. ✔ test
7. **Move** writes the new column and refuses a column that is not on the board. ✔ test
8. **Delete** needs the confirm step; a first click only arms it. ✔ test
9. **Filters** compose: arena + priority + due + status together return the right rows. ✔ test
10. **Board view** puts a task with an unknown or missing column under Unsorted. ✔ test
11. **Project counts** are done/total over linked tasks, 0/0 when none. ✔ test
12. Every mutation is a server action that calls `requireOwner()` and returns a `FormState`
    message near its control; no raw DB errors reach the screen.
13. `/work` and `/work/projects` have no horizontal overflow at 375 px, and quick capture is one
    tap away on a phone.
14. **`npm run check` is green.**

---

## 10. Accepted trade-offs

- **URL state over client state.** Filters, view, board and the open drawer are query parameters.
  More round trips than a client-side board, but every screen is a plain server render, works
  without JS, and survives a refresh. Revisit only if it feels slow with real data.
- **Two-step delete instead of a modal.** A confirm dialog needs client state and a focus trap to
  be accessible; an arming button is two keystrokes and needs neither.
- **Board membership stays manual.** Nothing auto-files a task onto a board. Triage picks one, and
  the list view is the catch-all for everything else.

---

## 11. Changed during BUILD

Two things the browser pass turned up that this spec did not anticipate. Recorded here rather
than left in the diff, per the REVIEW gate in `docs/CONTEXT.md`.

### `boards.position`

Work opens on the first board. Ordering boards by name opened it on "Collective AI" — empty,
while the day's tasks sat on "This week". Ordering by `created_at` did not help either: the seed
writes all four boards in one statement, so they share a timestamp and the tie falls back to the
alphabet. Board order is now a column the seed sets explicitly, which is also what a board
reordering UI will need later. One extra line in the M2 migration.

### Dated captures stay in Command's "Due this week"

This spec first had the due list show triaged tasks only, leaving captures to the inbox. On
screen the tile said 3 and the list showed 2, because the tile never had that exclusion — and
the tile was right. A capture with a date is due; filing it onto a board is clerical work, and
hiding dated work until that happens is backwards. The list now matches the tile, and a test
asserts the two reconcile.

### Not built as planned

`src/components/mobile-nav.tsx` is not a separate file. The menu button needs the same
`usePathname` the sidebar already has, so it lives in `sidebar.tsx` instead of a second client
component passing state between them.
