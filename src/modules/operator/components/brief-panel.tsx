import Link from "next/link";
import { regenerateBriefAction } from "../actions";

/**
 * Today's brief on Command, collapsible.
 *
 * A `<details>` rather than a toggle: it works with no JavaScript, and the open state is a URL
 * (`?brief=closed`) like every other piece of state since M2 — so a closed brief stays closed
 * through a reload, and a link to Command can carry either.
 *
 * Shown whole when open rather than truncated: it is the one thing on this screen written to be
 * read start to finish.
 */
export function BriefPanel({
  brief,
  open,
}: {
  brief: { day: string; body: string; source: string } | null;
  open: boolean;
}) {
  return (
    <section aria-labelledby="brief-heading" className="mt-10">
      <details open={open} className="rounded-[--radius-panel] border border-line bg-surface">
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-3 px-4 py-3">
          <h2 id="brief-heading" className="text-lg font-semibold">
            This morning
          </h2>
          {brief ? <span className="font-mono text-xs text-muted">{brief.day}</span> : null}
          <Link
            href={open ? "/?brief=closed" : "/"}
            scroll={false}
            className="ml-auto text-xs text-muted underline hover:text-ink"
          >
            {open ? "Keep it closed" : "Keep it open"}
          </Link>
        </summary>

        <div className="border-t border-line px-4 py-3">
          {brief ? (
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{brief.body}</p>
          ) : (
            <p className="text-sm text-muted">
              No brief for today yet. It is written automatically each morning, or you can write it now.
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
      </details>
    </section>
  );
}
