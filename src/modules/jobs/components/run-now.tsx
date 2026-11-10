"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form";
import type { FormState } from "@/lib/auth/actions";
import { runJobNowAction } from "../actions";

const initial: FormState = {};

/** Run one job on demand. On a once-a-day cron this is how anything happens in between. */
export function RunNow({ job }: { job: string }) {
  const [state, action, pending] = useActionState(runJobNowAction, initial);

  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-3">
      <input type="hidden" name="job" value={job} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-[--radius-control] border border-line-strong px-2.5 py-1 text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-60"
      >
        {pending ? "Running…" : "Run now"}
      </button>
      <FormMessage state={state} />
    </form>
  );
}
