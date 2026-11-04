import Link from "next/link";
import { regenerateBriefAction } from "../actions";

/**
 * Today's brief on Command.
 *
 * Shown whole rather than truncated: it is the one thing on this screen written to be read
 * start to finish. Regenerate is here because a brief written at 06:30 is already a little out
 * of date by the time Devon reads it.
 */
export function BriefPanel({ brief }: { brief: { day: string; body: string; source: string } | null }) {
  return (
    <section aria-labelledby="brief-heading" className="mt-10">
      <h2 id="brief-heading" className="mb-3 flex flex-wrap items-baseline gap-3 text-lg font-semibold">
        This morning
        {brief ? <span className="font-mono text-xs text-muted">{brief.day}</span> : null}
      </h2>

      <div className="rounded-[--radius-panel] border border-line bg-surface p-4">
        {brief ? (
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{brief.body}</p>
        ) : (
          <p className="text-sm text-muted">
            No brief for today yet. It is written automatically after 06:30, or you can write it now.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <form action={regenerateBriefAction}>
            <button
              type="submit"
              className="rounded-[--radius-control] border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent"
            >
              {brief ? "Regenerate" : "Write it now"}
            </button>
          </form>
          <Link href="/operator" className="text-sm text-muted underline hover:text-ink">
            Ask the Operator about it
          </Link>
        </div>
      </div>
    </section>
  );
}
