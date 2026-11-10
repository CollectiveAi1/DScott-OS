# Context

Shared vocabulary and the way this repo is built. Read before starting any module.

## Domain terms

| Term | Meaning |
| --- | --- |
| Arena | The life area a record belongs to: `collective`, `basketball`, `family`, `misc`. Kinetic Edge, Civic Sports and client builds are `collective`. |
| Command | Home screen: what needs Devon now. |
| Operator | The single assistant. Reads every module, acts only through tools. Orchestrator role in the agent model. |
| Worker | A tool or service the Operator hands a task to (calendar sync, Windows-MCP, Conductor, Voicebox). |
| Approval | A drafted outbound action waiting for Devon's yes. Nothing reaches another person without one. |
| Sandbox / Live | Delivery mode. Sandbox records approvals and sends nothing; live delivers. |
| Misc inbox | Untriaged quick captures (`tasks.from_misc = true`). |
| Protected time | Blocks the Operator never books over. |

## How work moves: DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP

| Stage | In this repo | Gate |
| --- | --- | --- |
| DEFINE | `docs/specs/SPEC-NNN-<module>.md`: acceptance criteria, edge cases, data touched | Devon agrees with the criteria |
| PLAN | `docs/plans/PLAN-NNN-<module>.md`: files to change, schema changes, tasks small enough for one session | No task spans unrelated modules |
| BUILD | Code + tests, written test first where logic is non-trivial. Run `npm run typecheck` on every change | Compiles clean |
| VERIFY | `npm test` | All tests pass |
| REVIEW | Read the diff against the spec. Unplanned files or public interfaces mean the spec gets updated or the change gets split. `npm audit --omit=dev` | No unplanned scope, no new high findings |
| SHIP | `npm run check` (typecheck, tests, production build), push, deploy, log the gate in `docs/build-log.md` | Check passes; build log updated |

Cheap checks run constantly; the production build runs only at SHIP.

## Where decisions live

- `docs/build-log.md`: one dated entry per phase gate. This log becomes the template for the next OS.
- `docs/adr/NNNN-<title>.md`: only for decisions that need their reasoning recorded (a stack choice, a security trade-off).
- `docs/handoff.md`: written at the end of a session that leaves work unfinished, covering state, open tasks and next step. Deleted once picked up.

## Agent contract (v3)

Workers receive a task payload: `task_id`, `task_type`, `inputs` (with `timeout_seconds`), `tool_allocations`, and a trace id. Any worker action that reaches another person or spends money returns an approval, never a direct send. Windows-MCP runs on the `balanced` policy.

Full reference material lives in the claude.ai project docs `info for the OS` and `claude/os-context-additions.md`.

## Before the next OS is built from this one

This repository is the template. Three things in it are **specific to Devon's instance** and
have to be replaced, not copied, when the next OS is built — and all three are the kind that
look fine until the moment they don't.

| Carry over | Replace, and why |
| --- | --- |
| `.env.local` | **Google OAuth credentials.** This instance ships placeholders that have the right domain and the wrong project number, so that Settings' connected and not-connected states can be exercised locally. They cannot complete a consent flow. Settings warns when it sees them (`hasPlaceholderCredentials`), which is the reminder — but a new OS needs its **own** Google Cloud OAuth client, with its own redirect URI, published rather than left in Testing |
| `.env.local` and the deployment | **Every secret.** `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` are per instance. Reusing one means two OSes that can read each other's sessions or stored tokens. `openssl rand -base64 32` each, every time |
| `docs/PRD.md` §6 | **Model ids.** They have a shelf life. Confirm each against the provider's current model list before it goes into a spec — a wrong one is valid-looking text that fails only at the first real call. See §6.1 |

The first of these has already cost a confusing hour once: placeholder credentials make Settings
say Google is configured, and then consent dies on Google's side with a message that explains
nothing. That is why the check exists in the app rather than only in this document.
