import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { MAX_PROTECTED_BLOCKS, supportedTimeZones } from "@/lib/settings-rules";
import { getDb } from "@/db/client";
import { JOBS } from "@/modules/jobs/registry";
import { recentRunsByJob } from "@/modules/jobs/queries";
import { describeSchedule } from "@/modules/jobs/schedule";
import type { JobRun } from "@/modules/jobs/service";
import { callbackUrl, isConfigured } from "@/modules/google/api";
import { GoogleConnection, type CalendarOption } from "@/modules/google/components/connection";
import { availableCalendars } from "@/modules/google/service";
import { readConnection } from "@/modules/google/tokens";
import { count, eq } from "drizzle-orm";
import { calendarEvents } from "@/db/schema";
import { PipelineSettingsPanel } from "@/modules/crm/components/pipeline-settings";
import { listPipelines } from "@/modules/crm/queries";
import { DeliveryModeForm, PasswordForm, ProtectedTimeForm, TimezoneForm } from "./forms";
import { hasModelKey } from "@/lib/model";
import { tokenUsage } from "@/modules/operator/queries";
import { RunNow } from "@/modules/jobs/components/run-now";

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

const CONNECT_NOTICE: Record<string, string> = {
  connected: "Connected to Google. Pick the calendars that feed Family.",
  denied: "Google access was declined, so nothing changed.",
  bad_state: "That sign-in link had expired. Start again.",
  no_code: "Google did not send an authorisation code. Try again.",
  failed: "Connecting to Google failed. Try again.",
  not_configured: "Google is not configured on this deployment.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getSettings();
  const runsByJob = await recentRunsByJob(getDb());

  const params = await searchParams;
  const outcome = Array.isArray(params.google) ? params.google[0] : params.google;
  const notice = outcome ? CONNECT_NOTICE[outcome] : undefined;

  // The connection's own state decides how much of the panel there is to draw.
  const connection = isConfigured() ? await readConnection() : ({ status: "none" } as const);
  const panelStatus = !isConfigured() ? "not_configured" : connection.status;

  let calendars: CalendarOption[] = [];
  if (panelStatus === "ok") {
    const listed = await availableCalendars();
    if (listed.ok) {
      const picked = new Set(current.calendarSources.map((source) => source.calendarId));
      calendars = listed.data.map((calendar) => ({ ...calendar, picked: picked.has(calendar.id) }));
    }
  }

  const crmPipelines = await listPipelines(getDb());

  // Thirty days of Operator spend. Logged and shown rather than capped: a cap that refuses
  // mid-turn is worse than a number Devon can see, for one instance with one owner.
  const usage = await tokenUsage(getDb(), new Date(Date.now() - 30 * 24 * 3_600_000));

  const [syncedCount] = await getDb()
    .select({ n: count() })
    .from(calendarEvents)
    .where(eq(calendarEvents.source, "google"));

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
        id="connections-heading"
        heading="Connections"
        description="Google Calendar feeds the Family arena. Nothing is ever written back."
      >
        <GoogleConnection
          status={panelStatus}
          reason={connection.status === "broken" ? connection.reason : undefined}
          email={connection.status === "ok" ? connection.email : undefined}
          calendars={calendars}
          sources={current.calendarSources.map((source) => ({
            calendarId: source.calendarId,
            summary: source.summary,
            lastSyncedAt: source.lastSyncedAt,
            lastError: source.lastError,
          }))}
          eventCount={syncedCount?.n ?? 0}
          timeZone={current.timezone}
          callbackUrl={callbackUrl()}
          notice={notice}
        />
      </Panel>

      <Panel
        id="pipelines-heading"
        heading="Pipelines"
        description="The seed's stages are drafts. Rename them, reorder them, and choose which ones raise an invoice task."
      >
        <PipelineSettingsPanel
          pipelines={crmPipelines.map((pipeline) => ({
            id: pipeline.id,
            name: pipeline.name,
            stages: pipeline.stages,
            billingStages: pipeline.billingStages,
          }))}
        />
      </Panel>

      <Panel
        id="jobs-heading"
        heading="Scheduled jobs"
        description="The last 10 runs of each job. The deploy runs one cron a day, so Run now is how anything happens in between."
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
                <RunNow job={job.name} />
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
        id="usage-heading"
        heading="Operator usage"
        description="Tokens sent to and received from the model over the last 30 days, across every thread."
      >
        {usage.turns === 0 ? (
          <p className="mt-4 text-sm text-muted">
            {hasModelKey()
              ? "No turns yet."
              : "No model key is set, so the Operator is closed. Briefs still run from the template."}
          </p>
        ) : (
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-muted">Turns</dt>
              <dd className="font-mono text-ink">{usage.turns.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt className="text-muted">Input tokens</dt>
              <dd className="font-mono text-ink">{usage.input.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt className="text-muted">Output tokens</dt>
              <dd className="font-mono text-ink">{usage.output.toLocaleString("en-US")}</dd>
            </div>
          </dl>
        )}
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
