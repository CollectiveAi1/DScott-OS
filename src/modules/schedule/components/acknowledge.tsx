"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/auth/actions";
import { acknowledgeConflictAction } from "../actions";

const initial: FormState = {};

/** Accepts a clash Devon has already decided is fine. Moving either event brings it back. */
export function AcknowledgeButton({ a, b }: { a: string; b: string }) {
  const [state, action, pending] = useActionState(acknowledgeConflictAction, initial);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="a" value={a} />
      <input type="hidden" name="b" value={b} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {pending ? "…" : "Acknowledge"}
      </button>
      {state.error ? (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
