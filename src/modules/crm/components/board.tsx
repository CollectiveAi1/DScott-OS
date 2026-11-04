"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Field, FormMessage, Select } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { createDealAction, deleteDealAction, moveDealAction, updateDealAction } from "../actions";
import { dealState, needsAttention } from "../deal-state";
import { centsToInput, formatCentsShort } from "../money";
import type { Board, BoardDeal } from "../queries";

const initial: FormState = {};

function Message({ state }: { state: FormState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={`text-xs ${state.error ? "text-danger" : "text-accent"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

/** One submit button per stage, inside a native disclosure: keyboard-operable with no JS. */
function MoveMenu({ dealId, stages, current }: { dealId: string; stages: string[]; current: string }) {
  const [state, action] = useActionState(moveDealAction, initial);
  const targets = stages.filter((stage) => stage !== current);
  if (targets.length === 0) return null;

  return (
    <details>
      <summary className="inline-block cursor-pointer list-none rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
        Move to…
      </summary>
      <form action={action} className="mt-1 space-y-1 rounded-[--radius-control] border border-line bg-surface-raised p-1.5">
        <input type="hidden" name="dealId" value={dealId} />
        {targets.map((stage) => (
          <button
            key={stage}
            type="submit"
            name="stage"
            value={stage}
            className="block w-full rounded-[--radius-control] px-2 py-1 text-left text-xs text-ink hover:bg-surface"
          >
            {stage}
          </button>
        ))}
        <Message state={state} />
      </form>
    </details>
  );
}

function DealCard({ deal, stages, today }: { deal: BoardDeal; stages: string[]; today: string }) {
  const state = dealState(deal, today);
  const flagged = needsAttention(state);

  return (
    <article
      className={`rounded-[--radius-panel] border bg-surface p-3 ${
        flagged ? "border-l-[3px] border-line border-l-danger" : "border-line"
      }`}
    >
      <Link href={`/pipelines?deal=${deal.id}`} className="block text-sm text-ink hover:text-accent">
        {deal.title}
      </Link>
      <p className="mt-1 font-mono text-xs text-muted">
        {formatCentsShort(deal.valueCents)}
        {deal.contactName ? ` · ${deal.contactName}` : ""}
      </p>

      {state.kind === "ok" ? (
        <p className="mt-1 text-xs text-muted">
          {deal.nextStep}
          {deal.nextStepDue ? <span className="font-mono"> · {deal.nextStepDue}</span> : null}
        </p>
      ) : (
        <p className="mt-1 text-xs text-danger">
          {state.label}
          {state.kind === "overdue" ? <span className="font-mono"> · {deal.nextStepDue}</span> : null}
        </p>
      )}

      <div className="mt-3">
        <MoveMenu dealId={deal.id} stages={stages} current={deal.stage} />
      </div>
    </article>
  );
}

export type DealValues = {
  id?: string;
  title: string;
  pipelineId: string;
  contactId: string;
  stage: string;
  value: string;
  nextStep: string;
  nextStepDue: string;
  owner: string;
};

function DeleteDeal({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteDealAction, initial);
  const [armed, setArmed] = useState(false);
  return (
    <form action={action} onSubmit={() => setArmed(true)} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      {armed ? <input type="hidden" name="confirm" value="yes" /> : null}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-[--radius-control] border px-3 py-1.5 text-sm disabled:opacity-60 ${
          armed ? "border-danger text-danger" : "border-line-strong text-muted hover:border-danger hover:text-danger"
        }`}
      >
        {armed ? "Really delete?" : "Delete deal"}
      </button>
      {armed ? <Message state={state} /> : null}
    </form>
  );
}

export function DealForm({
  values,
  pipelines,
  contacts,
  onDone,
}: {
  values: DealValues;
  pipelines: { id: string; name: string; stages: string[] }[];
  contacts: { id: string; name: string }[];
  onDone?: string;
}) {
  const editing = Boolean(values.id);
  const [state, action, pending] = useActionState(editing ? updateDealAction : createDealAction, initial);

  const [title, setTitle] = useState(values.title);
  const [pipelineId, setPipelineId] = useState(values.pipelineId);
  const [contactId, setContactId] = useState(values.contactId);
  const [stage, setStage] = useState(values.stage);
  const [value, setValue] = useState(values.value);
  const [nextStep, setNextStep] = useState(values.nextStep);
  const [nextStepDue, setNextStepDue] = useState(values.nextStepDue);
  const [owner, setOwner] = useState(values.owner);

  const settled = useRef<FormState | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state === settled.current) return;
    settled.current = state;
    setRound((current) => current + 1);
    if (state.ok && !editing) {
      setTitle("");
      setValue("");
      setNextStep("");
      setNextStepDue("");
    }
  }, [state, editing]);

  const stages = pipelines.find((pipeline) => pipeline.id === pipelineId)?.stages ?? [];

  return (
    <div className="space-y-5">
      <form action={action} className="grid gap-4 sm:grid-cols-2">
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <div className="sm:col-span-2">
          <Field label="Title" name="title" value={title} onChange={setTitle} autoComplete="off" />
        </div>

        <Select
          key={`pipeline-${round}`}
          label="Pipeline"
          name="pipelineId"
          options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
          value={pipelineId}
          onChange={(next) => {
            setPipelineId(next);
            const first = pipelines.find((pipeline) => pipeline.id === next)?.stages[0] ?? "";
            setStage(first);
          }}
        />
        <Select key={`stage-${round}`} label="Stage" name="stage" options={stages} value={stage} onChange={setStage} />

        <Field
          label="Value"
          name="value"
          value={value}
          onChange={setValue}
          required={false}
          autoComplete="off"
          hint="Typed how you say it: $1,250."
        />
        <Select
          key={`contact-${round}`}
          label="Contact"
          name="contactId"
          options={[
            { value: "", label: contacts.length ? "No contact" : "No contacts yet" },
            ...contacts.map((contact) => ({ value: contact.id, label: contact.name })),
          ]}
          value={contactId}
          onChange={setContactId}
        />

        <Field label="Next step" name="nextStep" value={nextStep} onChange={setNextStep} required={false} autoComplete="off" />
        <label className="block">
          <span className="mb-1.5 block text-sm text-muted">Next step due</span>
          <input
            type="date"
            name="nextStepDue"
            value={nextStepDue}
            onChange={(event) => setNextStepDue(event.target.value)}
            className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-ink focus:border-accent focus:outline-none"
          />
        </label>

        <Field label="Owner" name="owner" value={owner} onChange={setOwner} required={false} autoComplete="off" />

        <div className="sm:col-span-2">
          <Message state={state} />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[--radius-control] bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-60"
            >
              {pending ? "Saving…" : editing ? "Save deal" : "Add deal"}
            </button>
            {onDone ? (
              <Link href={onDone} className="text-sm text-muted underline hover:text-ink">
                Close
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {values.id ? <DeleteDeal id={values.id} /> : null}
    </div>
  );
}

export function PipelineBoard({ board, today }: { board: Board; today: string }) {
  const stages = board.pipeline.stages;
  const total = board.columns.reduce((sum, column) => sum + column.deals.length, 0);

  return (
    <section aria-labelledby={`pipeline-${board.pipeline.id}`} className="mb-10">
      <h2 id={`pipeline-${board.pipeline.id}`} className="mb-3 flex flex-wrap items-baseline gap-3 text-lg font-semibold">
        {board.pipeline.name}
        <span className="font-mono text-xs text-muted">
          {total} deal{total === 1 ? "" : "s"}
        </span>
        {board.pipeline.billingStages.length > 0 ? (
          <span className="text-xs font-normal text-muted">
            Billing at {board.pipeline.billingStages.join(", ")}
          </span>
        ) : null}
      </h2>

      <div className="overflow-x-auto">
        <div className="flex min-w-full gap-3" style={{ width: `max(100%, ${board.columns.length * 15}rem)` }}>
          {board.columns.map((column) => (
            <div key={column.stage} className="min-w-56 flex-1">
              <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-ink">
                {column.stage}
                <span className="font-mono text-xs text-muted">{column.deals.length}</span>
                {board.pipeline.billingStages.includes(column.stage) ? (
                  <span className="text-[10px] font-normal uppercase tracking-wider text-accent">billing</span>
                ) : null}
              </h3>
              <div className="space-y-2">
                {column.deals.length === 0 ? (
                  <p className="rounded-[--radius-panel] border border-dashed border-line px-3 py-4 text-xs text-muted">
                    Nothing here.
                  </p>
                ) : (
                  column.deals.map((deal) => <DealCard key={deal.id} deal={deal} stages={stages} today={today} />)
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
