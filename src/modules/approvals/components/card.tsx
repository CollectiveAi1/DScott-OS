"use client";

import { useActionState, useState } from "react";
import { ArenaTag, type ArenaName } from "@/components/arena-tag";
import { FormMessage } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { approveAction, rejectAction, requeueAction, saveAction } from "../actions";
import { isOpen } from "../machine";
import { recipientOf } from "../payloads";
import type { ApprovalRow } from "../queries";

const initial: FormState = {};

const CREATOR: Record<string, string> = {
  devon: "you",
  operator: "the Operator",
  automation: "an automation",
};

function field(payload: unknown, path: string): string {
  const parts = path.split(".");
  let value: unknown = payload;
  for (const part of parts) {
    if (typeof value !== "object" || value === null) return "";
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" ? value : "";
}

function Input({
  label,
  name,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      <input
        name={name}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[--radius-control] border border-line-strong bg-base px-2 py-1.5 text-sm text-ink read-only:text-muted focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function Body({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted">Message</span>
      <textarea
        name="body"
        rows={5}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[--radius-control] border border-line-strong bg-base px-2 py-1.5 text-sm text-ink read-only:text-muted focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function Decision({
  approval,
  mode,
}: {
  approval: ApprovalRow;
  mode: "sandbox" | "live";
}) {
  const [approveState, approveSubmit, approving] = useActionState(approveAction, initial);
  const [rejectState, rejectSubmit, rejecting] = useActionState(rejectAction, initial);
  const [requeueState, requeueSubmit, requeuing] = useActionState(requeueAction, initial);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
      {approval.status === "waiting" ? (
        <form action={approveSubmit}>
          <input type="hidden" name="id" value={approval.id} />
          <button
            type="submit"
            disabled={approving}
            className="rounded-[--radius-control] bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
          >
            {approving ? "Approving…" : mode === "sandbox" ? "Approve (sandbox)" : "Approve and send"}
          </button>
        </form>
      ) : null}

      {approval.status === "waiting" || approval.status === "scheduled" ? (
        <form action={rejectSubmit}>
          <input type="hidden" name="id" value={approval.id} />
          <button
            type="submit"
            disabled={rejecting}
            className="rounded-[--radius-control] border border-line-strong px-3 py-2 text-sm text-muted hover:border-danger hover:text-danger disabled:opacity-60"
          >
            {rejecting ? "…" : approval.status === "scheduled" ? "Cancel it" : "Reject"}
          </button>
        </form>
      ) : null}

      {approval.status === "failed" ? (
        <form action={requeueSubmit}>
          <input type="hidden" name="id" value={approval.id} />
          <button
            type="submit"
            disabled={requeuing}
            className="rounded-[--radius-control] border border-line-strong px-3 py-2 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {requeuing ? "…" : "Back to Waiting"}
          </button>
        </form>
      ) : null}

      <FormMessage state={approveState} />
      <FormMessage state={rejectState} />
      <FormMessage state={requeueState} />
    </div>
  );
}

/**
 * One approval, with its payload editable and its decisions separate.
 *
 * The decision buttons sit **outside** the editable form on purpose: pressing Enter in any field
 * submits the save, never the approval. This is the one screen in the OS where a reflex must not
 * be able to send something to another person.
 */
export function ApprovalCard({ approval, mode }: { approval: ApprovalRow; mode: "sandbox" | "live" }) {
  const [state, action, pending] = useActionState(saveAction, initial);
  const editable = approval.status === "waiting";

  const [to, setTo] = useState(field(approval.payload, "to"));
  const [subject, setSubject] = useState(field(approval.payload, "subject"));
  const [body, setBody] = useState(field(approval.payload, "body"));
  const [calendarId, setCalendarId] = useState(field(approval.payload, "calendarId"));
  const [title, setTitle] = useState(field(approval.payload, "event.title"));
  const [startsAt, setStartsAt] = useState(field(approval.payload, "event.startsAt"));
  const [endsAt, setEndsAt] = useState(field(approval.payload, "event.endsAt"));

  return (
    <article className="rounded-[--radius-panel] border border-line bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {approval.kind.replace("_", " ")} → {recipientOf(approval.kind, approval.payload)}
          </h3>
          <p className="text-xs text-muted">
            Drafted by {CREATOR[approval.createdBy] ?? approval.createdBy}
            {approval.contactName ? ` · ${approval.contactName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ArenaTag arena={approval.arena as ArenaName} />
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">{approval.status}</span>
        </div>
      </header>

      {approval.failureReason ? (
        <p role="status" className="mb-3 text-sm text-danger">
          {approval.failureReason}
        </p>
      ) : null}

      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={approval.id} />
        <input type="hidden" name="kind" value={approval.kind} />

        {approval.kind === "email" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="To" name="to" value={to} onChange={setTo} readOnly={!editable} />
              <Input label="Subject" name="subject" value={subject} onChange={setSubject} readOnly={!editable} />
            </div>
            <Body value={body} onChange={setBody} readOnly={!editable} />
          </>
        ) : null}

        {approval.kind === "text" ? (
          <>
            <Input label="To" name="to" value={to} onChange={setTo} readOnly={!editable} />
            <Body value={body} onChange={setBody} readOnly={!editable} />
          </>
        ) : null}

        {approval.kind === "calendar_write" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Calendar" name="calendarId" value={calendarId} onChange={setCalendarId} readOnly={!editable} />
            <Input label="Title" name="title" value={title} onChange={setTitle} readOnly={!editable} />
            <Input label="Starts" name="startsAt" value={startsAt} onChange={setStartsAt} readOnly={!editable} />
            <Input label="Ends" name="endsAt" value={endsAt} onChange={setEndsAt} readOnly={!editable} />
          </div>
        ) : null}

        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save draft"}
            </button>
            <span className="text-xs text-muted">Enter saves. It never approves.</span>
            <FormMessage state={state} />
          </div>
        ) : null}
      </form>

      {isOpen(approval.status) ? <Decision approval={approval} mode={mode} /> : null}
    </article>
  );
}
