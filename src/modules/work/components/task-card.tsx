"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArenaTag, type ArenaName } from "@/components/arena-tag";
import type { FormState } from "@/lib/auth/actions";
import { completeAction, moveAction, reopenAction } from "../actions";
import type { Task } from "../queries";

const initial: FormState = {};

const PRIORITY_STYLE: Record<string, string> = {
  urgent: "border-danger text-danger",
  high: "border-accent text-accent",
};

function Message({ state }: { state: FormState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={`text-xs ${state.error ? "text-danger" : "text-accent"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

/** One submit button per column. A native disclosure, so it is keyboard-operable with no JS. */
function MoveMenu({ taskId, columns, current }: { taskId: string; columns: string[]; current: string | null }) {
  const [state, action] = useActionState(moveAction, initial);
  const targets = columns.filter((column) => column !== current);
  if (targets.length === 0) return null;

  return (
    <details className="relative">
      <summary className="inline-block cursor-pointer list-none rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
        Move to…
      </summary>
      <form action={action} className="mt-1 space-y-1 rounded-[--radius-control] border border-line bg-surface-raised p-1.5">
        <input type="hidden" name="taskId" value={taskId} />
        {targets.map((column) => (
          <button
            key={column}
            type="submit"
            name="column"
            value={column}
            className="block w-full rounded-[--radius-control] px-2 py-1 text-left text-xs text-ink hover:bg-surface"
          >
            {column}
          </button>
        ))}
        <Message state={state} />
      </form>
    </details>
  );
}

function CompleteButton({ task }: { task: Task }) {
  const done = task.status === "done";
  const [state, action, pending] = useActionState(done ? reopenAction : completeAction, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="taskId" value={task.id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {pending ? "…" : done ? "Reopen" : "Complete"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function TaskCard({
  task,
  columns,
  today,
  drawerHref,
  projectName,
}: {
  task: Task;
  columns: string[];
  today: string;
  drawerHref: string;
  projectName?: string;
}) {
  const overdue = task.status === "open" && task.due !== null && task.due < today;

  return (
    <article className="rounded-[--radius-panel] border border-line bg-surface p-3">
      <Link href={drawerHref} className="block text-sm text-ink hover:text-accent">
        <span className={task.status === "done" ? "line-through decoration-muted" : ""}>{task.title}</span>
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ArenaTag arena={task.arena as ArenaName} />
        {task.due ? (
          <span className={`font-mono text-xs ${overdue ? "text-danger" : "text-muted"}`}>
            {task.due}
            {overdue ? " · overdue" : ""}
          </span>
        ) : null}
        {PRIORITY_STYLE[task.priority] ? (
          <span className={`rounded-[--radius-control] border px-1.5 py-0.5 text-[11px] ${PRIORITY_STYLE[task.priority]}`}>
            {task.priority}
          </span>
        ) : null}
        {projectName ? <span className="text-xs text-muted">{projectName}</span> : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {task.boardId ? <MoveMenu taskId={task.id} columns={columns} current={task.boardColumn} /> : null}
        <CompleteButton task={task} />
      </div>
    </article>
  );
}
