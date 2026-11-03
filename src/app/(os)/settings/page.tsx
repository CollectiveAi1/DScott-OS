import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { MAX_PROTECTED_BLOCKS, supportedTimeZones } from "@/lib/settings-rules";
import { getDb } from "@/db/client";
import { JOBS } from "@/modules/jobs/registry";
import { recentRunsByJob } from "@/modules/jobs/queries";
import { describeSchedule } from "@/modules/jobs/schedule";
import type { JobRun } from "@/modules/jobs/service";
import { DeliveryModeForm, PasswordForm, ProtectedTimeForm, TimezoneForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const STATUS_STYLE: Record<JobRun["status"], string> = {
  ok: "text-accent",
  error: "text-danger",
  skipped: "text-muted",
};

function Panel({
  id,
  heading,
  description,
  children,
}: {
  id: string;
  heading: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-[--radius-panel] border border-line bg-surface p-6">
      <h2 id={id} className="text-lg font-semibold">
        {heading}
      </h2>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      {children}
    </section>
  );
}

function RunRow({ run, timeZone }: { run: JobRun; timeZone: string }) {
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(run.startedAt);
  const seconds = (run.finishedAt.getTime() - run.startedAt.getTime()) / 1000;
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 font-mono text-xs">
      <span className="text-muted">{when}</span>
      <span className={STATUS_STYLE[run.status]}>{run.status}</span>
      <span className="text-muted">{seconds.toFixed(1)}s</span>
      {run.detail ? <span className="text-muted/80">{run.detail}</span> : null}
    </li>
  );
}

export default async function SettingsPage() {
  const current = await getSettings();
  const runsByJob = await recentRunsByJob(getDb());

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <h1 className="text-3xl font-semibold">Settings</h1>

      <Panel
        id="delivery-heading"
        heading="Delivery mode"
        description={
          current.deliveryMode === "sandbox"
            ? "Sandbox: approvals are recorded and nothing is sent."
            : "Live: approved emails, texts and calendar writes are delivered."
        }
      >
        <DeliveryModeForm mode={current.deliveryMode} />
      </Panel>

      <Panel
        id="time-heading"
        heading="Time zone"
        description="Everything dated in the OS is computed in this zone, not the server's."
      >
        <TimezoneForm timezone={current.timezone} zones={supportedTimeZones()} />
      </Panel>

      <Panel
        id="protected-heading"
        heading="Protected time"
        description={`Up to ${MAX_PROTECTED_BLOCKS} blocks the Operator will never book over.`}
      >
        <ProtectedTimeForm blocks={current.protectedTime} />
      </Panel>

      <Panel
        id="jobs-heading"
        heading="Scheduled jobs"
        description="The last 10 runs of each job. Jobs run from one cron tick every few minutes."
      >
        <ul className="mt-4 space-y-5">
          {JOBS.map((job) => {
            const runs = runsByJob.get(job.name) ?? [];
            return (
              <li key={job.name}>
                <p className="font-mono text-sm text-ink">{job.name}</p>
                <p className="text-xs text-muted">
                  {describeSchedule(job.schedule)} · {job.purpose}
                </p>
                {runs.length === 0 ? (
                  <p className="mt-1 text-xs text-muted/70">No runs yet.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-line">
                    {runs.map((run) => (
                      <RunRow key={run.id} run={run} timeZone={current.timezone} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel
        id="export-heading"
        heading="Export my data"
        description="Every table as one JSON file. Your password hash and stored connection keys are left out."
      >
        <a
          href="/api/export"
          download
          className="mt-4 inline-block rounded-[--radius-control] border border-line-strong px-4 py-2.5 text-sm text-ink hover:border-accent hover:text-accent"
        >
          Download JSON
        </a>
      </Panel>

      <Panel id="password-heading" heading="Password">
        <PasswordForm />
      </Panel>
    </div>
  );
}
