"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, Select, Textarea } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { updateTaskAction } from "../actions";
import { ARENA_OPTIONS, PRIORITY_OPTIONS } from "../filters";
import type { Board, Task } from "../queries";

const initial: FormState = {};

const ARENA_CHOICES = ARENA_OPTIONS.filter((option) => option.value !== "any");
const PRIORITY_CHOICES = PRIORITY_OPTIONS.filter((option) => option.value !== "any");

/**
 * The task detail, opened with ?task=<id> and closed by a link that drops it. Every field is
 * controlled, so a refusal leaves the edits on screen instead of reverting them.
 */
export function TaskDrawer({
  task,
  boards,
  projects,
  contacts,
  deals,
  closeHref,
}: {
  task: Task;
  boards: Board[];
  projects: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  deals: { id: string; name: string }[];
  closeHref: string;
}) {
  const [state, action, pending] = useActionState(updateTaskAction, initial);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [due, setDue] = useState(task.due ?? "");
  const [priority, setPriority] = useState<string>(task.priority);
  const [owner, setOwner] = useState(task.owner);
  const [arena, setArena] = useState<string>(task.arena);
  const [boardId, setBoardId] = useState(task.boardId ?? "");
  const [column, setColumn] = useState(task.boardColumn ?? "");
  const [projectId, setProjectId] = useState(task.projectId ?? "");
  const [contactId, setContactId] = useState(task.contactId ?? "");
  const [dealId, setDealId] = useState(task.dealId ?? "");

  const columns = boards.find((board) => board.id === boardId)?.columns ?? [];

  return (
    <aside
      aria-labelledby="drawer-heading"
      className="rounded-[--radius-panel] border border-line bg-surface p-4 lg:sticky lg:top-6"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id="drawer-heading" className="text-lg font-semibold">
          Task
        </h2>
        <Link href={closeHref} className="text-sm text-muted hover:text-ink">
          Close
        </Link>
      </div>

      <form action={action} className="space-y-4">
        <input type="hidden" name="taskId" value={task.id} />
        <Field label="Title" name="title" value={title} onChange={setTitle} autoComplete="off" />
        <Textarea label="Notes" name="notes" value={notes} onChange={setNotes} rows={4} />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm text-muted">Due</span>
            <input
              type="date"
              name="due"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <Select label="Priority" name="priority" options={PRIORITY_CHOICES} value={priority} onChange={setPriority} />
          <Select label="Arena" name="arena" options={ARENA_CHOICES} value={arena} onChange={setArena} />
          <Field label="Owner" name="owner" value={owner} onChange={setOwner} autoComplete="off" />
          <Select
            label="Board"
            name="boardId"
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
            options={[{ value: "", label: boardId ? "No column" : "Pick a board first" }, ...columns]}
            value={column}
            onChange={setColumn}
          />
        </div>

        <Select
          label="Project"
          name="projectId"
          options={[
            { value: "", label: projects.length ? "No project" : "No projects yet" },
            ...projects.map((project) => ({ value: project.id, label: project.name })),
          ]}
          value={projectId}
          onChange={setProjectId}
        />

        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <Select
            label="Contact"
            name="contactId"
            options={[
              { value: "", label: contacts.length ? "No contact" : "No contacts yet" },
              ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
            ]}
            value={contactId}
            onChange={setContactId}
          />
          <Select
            label="Deal"
            name="dealId"
            options={[
              { value: "", label: deals.length ? "No deal" : "No deals yet" },
              ...deals.map((deal) => ({ value: deal.id, label: deal.name })),
            ]}
            value={dealId}
            onChange={setDealId}
          />
        </div>

        <p
          role={state.error ? "alert" : "status"}
          className={`text-sm ${state.error ? "text-danger" : "text-accent"}`}
        >
          {state.error ?? state.ok ?? ""}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[--radius-control] bg-accent px-4 py-2.5 font-semibold text-accent-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save task"}
        </button>
      </form>
    </aside>
  );
}
