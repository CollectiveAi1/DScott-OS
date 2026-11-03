import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { loadCommand } from "@/lib/command";
import { greetingFor } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { ArenaTag, type ArenaName } from "@/components/arena-tag";
import { QuickCapture } from "@/modules/work/components/quick-capture";

export const metadata: Metadata = { title: "Command" };

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

      <section aria-label="Quick capture" className="mb-8">
        <QuickCapture />
      </section>

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
            Nothing due this week. Capture something above, or open{" "}
            <Link href="/work" className="underline hover:text-ink">
              Work
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
            {snapshot.dueList.map((task) => {
              const overdue = task.due !== null && task.due < snapshot.today;
              return (
                <li key={task.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <Link href={`/work?view=list&task=${task.id}`} className="hover:text-accent">
                    {task.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-3">
                    <ArenaTag arena={task.arena as ArenaName} />
                    <span className={`font-mono text-xs ${overdue ? "text-danger" : "text-muted"}`}>
                      {task.due}
                      {overdue ? " · overdue" : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {snapshot.needsAttention.length > 0 ? (
        <section aria-labelledby="attention-heading" className="mt-10">
          <h2 id="attention-heading" className="mb-3 text-lg font-semibold">
            Needs attention
          </h2>
          <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
            {snapshot.needsAttention.map((item) => (
              <li key={item.id} className="px-4 py-3">
                <p className="font-mono text-xs uppercase tracking-wider text-danger">{item.kind}</p>
                <Link href={item.href} className="mt-1 block text-sm text-ink hover:text-accent">
                  {item.title}
                </Link>
                <p className="mt-0.5 text-xs text-muted">{item.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
