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
