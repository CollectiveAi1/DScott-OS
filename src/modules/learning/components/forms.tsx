"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Field, FormMessage, Select, Textarea } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import {
  createItemAction,
  createSkillAction,
  deleteItemAction,
  deletePracticeAction,
  deleteSkillAction,
  logPracticeAction,
  updateItemAction,
  updateSkillAction,
  writeReviewAction,
} from "../actions";
import { ITEM_KINDS, ITEM_STATUSES } from "../service";

const initial: FormState = {};
const LEVELS = ["1", "2", "3", "4", "5"];

/** Remount selects and checkboxes once an action settles — the rule from M1–M3. */
function useSettleRound(state: FormState): number {
  const settled = useRef<FormState | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state === settled.current) return;
    settled.current = state;
    setRound((current) => current + 1);
  }, [state]);
  return round;
}

export type SkillValues = { id?: string; name: string; currentLevel: string; targetLevel: string; why: string };

export function SkillForm({ values }: { values: SkillValues }) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState(editing ? updateSkillAction : createSkillAction, initial);
  const round = useSettleRound(state);

  const [name, setName] = useState(values.name);
  const [currentLevel, setCurrentLevel] = useState(values.currentLevel);
  const [targetLevel, setTargetLevel] = useState(values.targetLevel);
  const [why, setWhy] = useState(values.why);

  return (
    <form action={action} className="space-y-4">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Skill" name="name" value={name} onChange={setName} autoComplete="off" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select key={`cur-${round}`} label="Where you are" name="currentLevel" options={LEVELS} value={currentLevel} onChange={setCurrentLevel} />
        <Select key={`tgt-${round}`} label="Where you want to be" name="targetLevel" options={LEVELS} value={targetLevel} onChange={setTargetLevel} />
      </div>
      <Textarea label="Why it matters" name="why" value={why} onChange={setWhy} rows={2} />
      <FormMessage state={state} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[--radius-control] bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-60"
      >
        {pending ? "Saving…" : editing ? "Save skill" : "Add skill"}
      </button>
    </form>
  );
}

export function DeleteSkill({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteSkillAction, initial);
  const [armed, setArmed] = useState(false);
  return (
    <form action={action} onSubmit={() => setArmed(true)} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={id} />
      {armed ? <input type="hidden" name="confirm" value="yes" /> : null}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-[--radius-control] border px-3 py-2 text-sm disabled:opacity-60 ${
          armed ? "border-danger text-danger" : "border-line-strong text-muted hover:border-danger hover:text-danger"
        }`}
      >
        {armed ? "Really delete this skill and its practice log?" : "Delete skill"}
      </button>
      {armed ? <FormMessage state={state} /> : null}
    </form>
  );
}

const QUICK = [15, 30, 60];

/**
 * The whole feature fails if logging practice takes longer than the practice felt worth, so the
 * common case is one button.
 */
export function QuickLog({ skillId, today }: { skillId: string; today: string }) {
  const [state, action, pending] = useActionState(logPracticeAction, initial);
  const round = useSettleRound(state);

  const [minutes, setMinutes] = useState("45");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (state.ok) setNote("");
  }, [state]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {QUICK.map((amount) => (
          <form key={amount} action={action}>
            <input type="hidden" name="skillId" value={skillId} />
            <input type="hidden" name="minutes" value={amount} />
            <input type="hidden" name="day" value={today} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-[--radius-control] border border-line-strong px-3 py-2 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-60"
            >
              +{amount}m today
            </button>
          </form>
        ))}
      </div>

      <details>
        <summary className="inline-block cursor-pointer list-none rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
          Another day, or a different amount
        </summary>
        <form key={`log-${round}`} action={action} className="mt-3 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="skillId" value={skillId} />
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">Date</span>
            <input
              type="date"
              name="day"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className="w-full rounded-[--radius-control] border border-line-strong bg-base px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">Minutes</span>
            <input
              type="number"
              name="minutes"
              min={1}
              max={1440}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="w-full rounded-[--radius-control] border border-line-strong bg-base px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[--radius-control] bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-60"
            >
              Log it
            </button>
          </div>
          <div className="sm:col-span-3">
            <Field label="Note" name="note" value={note} onChange={setNote} required={false} autoComplete="off" />
          </div>
        </form>
      </details>

      <FormMessage state={state} />
    </div>
  );
}

export type ItemValues = {
  id?: string;
  skillId: string;
  title: string;
  kind: string;
  status: string;
  due: string;
  url: string;
};

export function ItemForm({ values, compact = false }: { values: ItemValues; compact?: boolean }) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState(editing ? updateItemAction : createItemAction, initial);
  const round = useSettleRound(state);

  const [title, setTitle] = useState(values.title);
  const [kind, setKind] = useState(values.kind);
  const [status, setStatus] = useState(values.status);
  const [due, setDue] = useState(values.due);
  const [url, setUrl] = useState(values.url);

  useEffect(() => {
    if (state.ok && !editing) {
      setTitle("");
      setDue("");
      setUrl("");
    }
  }, [state, editing]);

  return (
    <form action={action} className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2"}>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="skillId" value={values.skillId} />

      <div className="sm:col-span-2">
        <Field label="What" name="title" value={title} onChange={setTitle} autoComplete="off" />
      </div>
      <Select key={`kind-${round}`} label="Kind" name="kind" options={[...ITEM_KINDS]} value={kind} onChange={setKind} />
      <Select key={`status-${round}`} label="Status" name="status" options={[...ITEM_STATUSES]} value={status} onChange={setStatus} />
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
      <Field label="Link" name="url" value={url} onChange={setUrl} required={false} autoComplete="off" />

      <div className="sm:col-span-2">
        <FormMessage state={state} />
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-[--radius-control] bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : editing ? "Save" : "Add item"}
        </button>
      </div>
    </form>
  );
}

export function RemoveButton({ id, action: which, label }: { id: string; action: "item" | "practice"; label: string }) {
  const [state, action, pending] = useActionState(
    which === "item" ? deleteItemAction : deletePracticeAction,
    initial,
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-danger hover:text-danger disabled:opacity-60"
      >
        {pending ? "…" : label}
      </button>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function WriteReview() {
  const [state, action, pending] = useActionState(writeReviewAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {pending ? "Writing…" : "Write it now"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}
