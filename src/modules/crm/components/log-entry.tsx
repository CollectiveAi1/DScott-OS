"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { logEntryAction } from "../actions";

const initial: FormState = {};

const KINDS = [
  { value: "note", label: "Add note", placeholder: "What is worth remembering?" },
  { value: "call", label: "Log call", placeholder: "What was said?" },
  { value: "meeting", label: "Log meeting", placeholder: "What came out of it?" },
] as const;

/** Add a note, log a call, log a meeting — the three ways a person's history grows by hand. */
export function LogEntry({ contactId, dealId }: { contactId?: string; dealId?: string }) {
  const [state, action, pending] = useActionState(logEntryAction, initial);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("note");
  const [body, setBody] = useState("");

  const settled = useRef<FormState | null>(null);
  useEffect(() => {
    if (state === settled.current) return;
    settled.current = state;
    // Clear only on a save; a refusal keeps what was written.
    if (state.ok) setBody("");
  }, [state]);

  const active = KINDS.find((option) => option.value === kind)!;

  return (
    <form action={action} className="space-y-3 rounded-[--radius-panel] border border-line bg-surface p-4">
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      {dealId ? <input type="hidden" name="dealId" value={dealId} /> : null}
      <input type="hidden" name="kind" value={kind} />

      <div className="flex flex-wrap gap-2">
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setKind(option.value)}
            aria-pressed={kind === option.value}
            className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent aria-pressed:border-accent aria-pressed:text-accent"
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="sr-only">{active.label}</span>
        <textarea
          name="body"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={active.placeholder}
          className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[--radius-control] bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : active.label}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
