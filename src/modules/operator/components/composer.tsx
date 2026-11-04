"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { sendAction } from "../actions";

const initial: FormState = {};

/**
 * The composer. Enter sends, Shift+Enter makes a line.
 *
 * This is the opposite choice from an approval card, and deliberately: nothing said here reaches
 * anyone, so the reflex is allowed to be the fast one. The one thing this screen can draft still
 * stops in the Approvals queue.
 */
export function Composer({ threadId }: { threadId: string | null }) {
  const [state, action, pending] = useActionState(sendAction, initial);
  const [text, setText] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // React 19 clears a form once its action settles; the draft is kept here so a refused send
  // does not throw away what was typed, and a successful one starts clean.
  useEffect(() => {
    if (state.ok) setText("");
  }, [state]);

  return (
    <form ref={formRef} action={action} className="mt-4 space-y-2">
      {threadId ? <input type="hidden" name="thread" value={threadId} /> : null}
      <label className="block">
        <span className="mb-1.5 block text-sm text-muted">Ask the Operator</span>
        <textarea
          name="text"
          rows={3}
          value={text}
          disabled={pending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (text.trim()) formRef.current?.requestSubmit();
            }
          }}
          placeholder="What does today look like?"
          className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-ink placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-60"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="rounded-[--radius-control] bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60"
        >
          {pending ? "Thinking…" : "Send"}
        </button>
        <span className="text-xs text-muted">Enter sends. Shift+Enter makes a line.</span>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
