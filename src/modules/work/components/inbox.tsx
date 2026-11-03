"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Select } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { completeAction, deleteAction, triageAction } from "../actions";
import { ARENA_OPTIONS, PRIORITY_OPTIONS } from "../filters";
import type { Board, Task } from "../queries";

const initial: FormState = {};

const ARENA_CHOICES = ARENA_OPTIONS.filter((option) => option.value !== "any");
const PRIORITY_CHOICES = PRIORITY_OPTIONS.filter((option) => option.value !== "any");

function Message({ state }: { state: FormState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={`text-xs ${state.error ? "text-danger" : "text-accent"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

/**
 * Deleting takes two presses: the first arms the button, the second sends `confirm`. A dialog
 * would need client state and a focus trap to be accessible; this needs neither.
 */
function DeleteButton({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(deleteAction, initial);
  const [armed, setArmed] = useState(false);

  return (
    <form action={action} onSubmit={() => setArmed(true)} className="inline-flex items-center gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      {armed ? <input type="hidden" name="confirm" value="yes" /> : null}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-[--radius-control] border px-2 py-1 text-xs disabled:opacity-60 ${
          armed ? "border-danger text-danger" : "border-line-strong text-muted hover:border-danger hover:text-danger"
        }`}
      >
        {armed ? "Really delete?" : "Delete"}
      </button>
      {armed ? <Message state={state} /> : null}
    </form>
  );
}

function TriageForm({ task, boards }: { task: Task; boards: Board[] }) {
  const [state, action] = useActionState(triageAction, initial);
  const [arena, setArena] = useState(task.arena);
  const [boardId, setBoardId] = useState("");
  const [column, setColumn] = useState("");
  const [due, setDue] = useState(task.due ?? "");
  const [priority, setPriority] = useState(task.priority);

  // Controlled throughout: React clears an uncontrolled form once its action settles, which on a
  // refusal would make Devon pick everything again.
  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
  }, [state]);

  const columns = boards.find((board) => board.id === boardId)?.columns ?? [];

  return (
    <details className="mt-2">
      <summary className="inline-block cursor-pointer list-none rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
        Make task
      </summary>
      <form action={action} className="mt-2 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="taskId" value={task.id} />
        <Select
          label="Arena"
          name="arena"
          compact
          options={ARENA_CHOICES}
          value={arena}
          onChange={(next) => setArena(next as typeof arena)}
        />
        <Select
          label="Priority"
          name="priority"
          compact
          options={PRIORITY_CHOICES}
          value={priority}
          onChange={(next) => setPriority(next as typeof priority)}
        />
        <Select
          label="Board"
          name="boardId"
          compact
          options={[{ value: "", label: "No board" }, ...boards.map((board) => ({ value: board.id, label: board.name }))]}
          value={boardId}
          onChange={(next) => {
            setBoardId(next);
            setColumn("");
          }}
        />
        <Select
          label="Column"
          name="boardColumn"
          compact
          options={[{ value: "", label: boardId ? "No column" : "Pick a board first" }, ...columns]}
          value={column}
          onChange={setColumn}
        />
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted">Due</span>
          <input
            type="date"
            name="due"
            value={due}
            onChange={(event) => setDue(event.target.value)}
            className="w-full rounded-[--radius-control] border border-line-strong bg-base px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-[--radius-control] bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink"
          >
            Save as task
          </button>
        </div>
        <div className="sm:col-span-2">
          <Message state={state} />
        </div>
      </form>
    </details>
  );
}

function DoneButton({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState(completeAction, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {pending ? "…" : "Done"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function MiscInbox({ items, boards }: { items: Task[]; boards: Board[] }) {
  return (
    <section aria-labelledby="inbox-heading" className="mb-10">
      <h2 id="inbox-heading" className="mb-3 text-lg font-semibold">
        Misc inbox{items.length > 0 ? <span className="ml-2 font-mono text-sm text-muted">{items.length}</span> : null}
      </h2>

      {items.length === 0 ? (
        <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
          Inbox clear. Anything you capture lands here until you sort it.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
          {items.map((task) => (
            <li key={task.id} className="px-4 py-3">
              <p className="text-sm text-ink">{task.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <DoneButton taskId={task.id} />
                <span
                  title="Events arrive with Schedule (M3)."
                  className="cursor-not-allowed rounded-[--radius-control] border border-line px-2 py-1 text-xs text-muted/50"
                  aria-disabled="true"
                >
                  Make event
                </span>
                <DeleteButton taskId={task.id} />
                <span className="text-xs text-muted/60">Events arrive with Schedule (M3).</span>
              </div>
              <TriageForm task={task} boards={boards} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
