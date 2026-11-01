import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth/session";
import { loadCommand } from "@/lib/command";
import { greetingFor } from "@/lib/dates";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Command" };

const ARENA_LABEL: Record<string, string> = {
  collective: "Collective AI",
  basketball: "Basketball",
  family: "Family",
  misc: "Misc",
};

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <article className="rounded-[--radius-panel] border border-line bg-surface p-4">
      <h2 className="text-xs uppercase tracking-wider text-muted">{label}</h2>
      <p className="mt-2 font-mono text-2xl text-ink">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
    </article>
  );
}

export default async function CommandPage() {
  const signedIn = await requireOwner();
  const { timezone } = await getSettings();
  const now = new Date();
  const snapshot = await loadCommand(timezone, now);
  const next = snapshot.nextGameOrTravel;
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" });
  const eventLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8">
        <p className="text-sm text-muted">{dateLabel.format(now)}</p>
        <h1 className="mt-1 text-3xl font-semibold">
          {greetingFor(now, timezone)}, {signedIn.name}.
        </h1>
      </header>

      <section aria-label="At a glance" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Waiting for approval" value={String(snapshot.waitingApprovals)} />
        <Tile
          label="Due this week"
          value={String(snapshot.dueThisWeek)}
          detail={snapshot.overdue > 0 ? `${snapshot.overdue} overdue` : undefined}
        />
        <Tile label="Deals moved · 7 days" value={String(snapshot.dealsMoved7d)} />
        <Tile
          label="Next game or travel"
          value={next ? eventLabel.format(next.startsAt) : "None scheduled"}
          detail={next ? next.title : "Schedule import arrives with the official team schedule."}
        />
      </section>

      <section aria-labelledby="due-heading" className="mt-10">
        <h2 id="due-heading" className="mb-3 text-lg font-semibold">
          Due this week
        </h2>
        {snapshot.dueList.length === 0 ? (
          <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
            Nothing due. Tasks arrive with the Work module in v1.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
            {snapshot.dueList.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span>{task.title}</span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {ARENA_LABEL[task.arena]} · {task.due}
                  {task.due && task.due < snapshot.today ? " · overdue" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
