"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { FormState } from "@/lib/auth/actions";
import { captureAction } from "../actions";

const initial: FormState = {};

const HINT = "#arena · !priority · due:tomorrow";

/**
 * One line in, one task out. Rendered twice: at the top of Command, and fixed to the bottom of
 * the screen on phones so a thought is always one tap from being written down.
 *
 * Controlled on purpose. React clears an uncontrolled form once its action settles, which would
 * throw the line away on a refusal — the same trap M1 hit with the protected-time block.
 */
export function QuickCapture({ variant = "panel" }: { variant?: "panel" | "bar" }) {
  const [state, action, pending] = useActionState(captureAction, initial);
  const [line, setLine] = useState("");
  const handled = useRef<FormState | null>(null);

  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    // Clear only on a save. A refusal keeps the words so they can be fixed, not retyped.
    if (state.ok) setLine("");
  }, [state]);

  const bar = variant === "bar";

  return (
    <form
      action={action}
      className={bar ? "flex items-end gap-2" : "rounded-[--radius-panel] border border-line bg-surface p-4"}
    >
      <div className={bar ? "flex flex-1 items-end gap-2" : "flex items-end gap-2"}>
      <label className="flex-1">
        <span className={bar ? "sr-only" : "mb-1.5 block text-sm text-muted"}>Quick capture</span>
        <input
          name="line"
          value={line}
          onChange={(event) => setLine(event.target.value)}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={bar ? `Capture — ${HINT}` : "Something on your mind…"}
          className="w-full rounded-[--radius-control] border border-line-strong bg-base px-3 py-2.5 text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 self-end rounded-[--radius-control] bg-accent px-4 py-2.5 font-semibold text-accent-ink transition-opacity disabled:opacity-60"
      >
        {pending ? "Saving…" : "Capture"}
      </button>
      </div>
      {bar ? null : (
        <p className="mt-2 font-mono text-xs text-muted">
          {HINT}
        </p>
      )}
      <p
        role={state.error ? "alert" : "status"}
        className={`${bar ? "sr-only" : "mt-2"} text-sm ${state.error ? "text-danger" : "text-accent"}`}
      >
        {state.error ?? state.ok ?? ""}
      </p>
    </form>
  );
}
