import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/session";
import { loadCommand } from "@/lib/command";
import { greetingFor } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { arenaLabel, ArenaTag, type ArenaName } from "@/components/arena-tag";
import { QuickCapture } from "@/modules/work/components/quick-capture";
import { AcknowledgeButton } from "@/modules/schedule/components/acknowledge";
import { eventRange } from "@/modules/schedule/components/event-chip";

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

      {snapshot.learningReview ? (
        <section aria-labelledby="review-heading" className="mt-10">
          <h2 id="review-heading" className="mb-3 flex flex-wrap items-baseline gap-3 text-lg font-semibold">
            Weekly review
            <span className="font-mono text-xs text-muted">{snapshot.learningReview.day}</span>
          </h2>
          <div className="rounded-[--radius-panel] border border-line bg-surface p-4">
            <p className="whitespace-pre-wrap text-sm text-ink">
              {snapshot.learningReview.body.split("\n").slice(0, 4).join("\n")}
            </p>
            <Link href="/learning" className="mt-3 inline-block text-sm text-muted underline hover:text-ink">
              Read it in Learning
            </Link>
          </div>
        </section>
      ) : null}

      {snapshot.conflicts.length > 0 ? (
        <section aria-labelledby="conflicts-heading" className="mt-10">
          <h2 id="conflicts-heading" className="mb-3 text-lg font-semibold">
            Conflicts
          </h2>
          <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
            {snapshot.conflicts.map((conflict) =>
              conflict.kind === "pair" ? (
                <li key={`${conflict.a.id}+${conflict.b.id}`} className="px-4 py-3">
                  <p className="font-mono text-xs uppercase tracking-wider text-danger">Double-booked</p>
                  <ul className="mt-1 space-y-0.5">
                    {[conflict.a, conflict.b].map((event) => (
                      <li key={event.id} className="text-sm">
                        <Link href={`/schedule/${event.id}`} className="text-ink hover:text-accent">
                          {event.title}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted">
                          {eventRange(event, timezone)} · {arenaLabel(event.arena as ArenaName)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2">
                    <AcknowledgeButton a={conflict.a.id} b={conflict.b.id} />
                  </div>
                </li>
              ) : (
                <li key={`${conflict.event.id}+${conflict.hit.date}+${conflict.hit.block.label}`} className="px-4 py-3">
                  <p className="font-mono text-xs uppercase tracking-wider text-danger">Protected time</p>
                  <p className="mt-1 text-sm">
                    <Link href={`/schedule/${conflict.event.id}`} className="text-ink hover:text-accent">
                      {conflict.event.title}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted">
                      {eventRange(conflict.event, timezone)} · {conflict.hit.date}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Runs into “{conflict.hit.block.label}”. Move the event, or change the block in{" "}
                    <Link href="/settings" className="underline hover:text-ink">
                      Settings
                    </Link>
                    .
                  </p>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

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
