"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArenaTag, type ArenaName } from "@/components/arena-tag";
import { Field, Select } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { createProjectAction, setProjectStatusAction } from "../actions";
import { ARENA_OPTIONS } from "../filters";
import type { ProjectSummary } from "../queries";

const initial: FormState = {};
const ARENA_CHOICES = ARENA_OPTIONS.filter((option) => option.value !== "any");
const STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
];

function Message({ state, className = "" }: { state: FormState; className?: string }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`text-xs ${state.error ? "text-danger" : "text-accent"} ${className}`}
    >
      {state.error ?? state.ok}
    </p>
  );
}

function StatusForm({ project }: { project: ProjectSummary }) {
  const [state, action] = useActionState(setProjectStatusAction, initial);
  return (
    <form action={action} className="flex items-end gap-2">
      <input type="hidden" name="projectId" value={project.id} />
      <div className="w-32">
        {/* Keyed on the saved status: React's post-action form reset would otherwise leave the
            select showing the value it had before the change. */}
        <Select key={project.status} label="Status" name="status" compact options={STATUSES} defaultValue={project.status} />
      </div>
      <button
        type="submit"
        className="rounded-[--radius-control] border border-line-strong px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-accent"
      >
        Set
      </button>
      <Message state={state} />
    </form>
  );
}

function NewProjectForm() {
  const [state, action, pending] = useActionState(createProjectAction, initial);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("Devon");
  const [due, setDue] = useState("");
  const [arena, setArena] = useState("collective");

  const handled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    // Clear only on a save; a refusal keeps what was typed.
    if (!state.ok) return;
    setName("");
    setDue("");
  }, [state]);

  return (
    <form action={action} className="grid gap-4 rounded-[--radius-panel] border border-line bg-surface p-4 sm:grid-cols-2">
      <Field label="Name" name="name" value={name} onChange={setName} autoComplete="off" />
      <Field label="Owner" name="owner" value={owner} onChange={setOwner} autoComplete="off" />
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
      <Select label="Arena" name="arena" options={ARENA_CHOICES} value={arena} onChange={setArena} />
      <div className="sm:col-span-2">
        <Message state={state} className="mb-2" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-[--radius-control] bg-accent px-4 py-2.5 font-semibold text-accent-ink disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add project"}
        </button>
      </div>
    </form>
  );
}

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  return (
    <div className="space-y-8">
      {projects.length === 0 ? (
        <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
          No projects yet. A project groups the tasks that add up to one piece of work.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
          {projects.map((project) => {
            const percent = project.total === 0 ? 0 : Math.round((project.done / project.total) * 100);
            return (
              <li key={project.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                <div className="min-w-0">
                  <p className="text-sm text-ink">{project.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ArenaTag arena={project.arena as ArenaName} />
                    <span className="text-xs text-muted">{project.owner}</span>
                    {project.due ? <span className="font-mono text-xs text-muted">{project.due}</span> : null}
                    <span className="font-mono text-xs text-muted">
                      {project.done}/{project.total} done
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${project.name} progress`}
                    className="mt-2 h-1 w-40 rounded-full bg-surface-raised"
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
                  </div>
                </div>
                <StatusForm project={project} />
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="new-project-heading">
        <h2 id="new-project-heading" className="mb-3 text-lg font-semibold">
          New project
        </h2>
        <NewProjectForm />
      </section>
    </div>
  );
}
