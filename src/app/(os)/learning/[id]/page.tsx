import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { DeleteSkill, ItemForm, QuickLog, RemoveButton, SkillForm } from "@/modules/learning/components/forms";
import { itemsForSkill, listSkills, practiceForSkill, skillById } from "@/modules/learning/queries";
import { formatMinutes } from "@/modules/learning/render";

export const metadata: Metadata = { title: "Skill" };

const STATUS_STYLE: Record<string, string> = {
  active: "text-accent",
  queued: "text-muted",
  done: "text-muted/60",
  dropped: "text-muted/60",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[--radius-panel] border border-line bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const db = getDb();
  const { timezone } = await getSettings();
  const today = dateInZone(new Date(), timezone);
  const { id } = await params;

  const skill = await skillById(db, id);
  if (!skill) notFound();

  const [items, practice, allSkills] = await Promise.all([
    itemsForSkill(db, id),
    practiceForSkill(db, id),
    listSkills(db, today),
  ]);
  const totals = allSkills.find((row) => row.id === id);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{skill.name}</h1>
          <p className="mt-1 font-mono text-sm text-muted">
            level {skill.currentLevel} → {skill.targetLevel} · {formatMinutes(totals?.last7 ?? 0)} in 7 days ·{" "}
            {formatMinutes(totals?.last30 ?? 0)} in 30
          </p>
        </div>
        <Link href="/learning" className="text-sm text-muted underline hover:text-ink">
          Back to Learning
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Log practice">
            <QuickLog skillId={skill.id} today={today} />
          </Panel>

          <Panel title={`Learning items (${items.length})`}>
            {items.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing yet. A course, a book, a video or a project — whatever the practice is on.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((item) => (
                  <li key={item.id} className="py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-sm text-ink underline hover:text-accent"
                          >
                            {item.title}
                          </a>
                        ) : (
                          <span className="text-sm text-ink">{item.title}</span>
                        )}
                        <p className="font-mono text-xs text-muted">
                          <span className={STATUS_STYLE[item.status]}>{item.status}</span> · {item.kind}
                          {item.due ? ` · due ${item.due}` : ""}
                          {item.due && item.due < today && item.status !== "done" && item.status !== "dropped" ? (
                            <span className="text-danger"> · past due</span>
                          ) : null}
                        </p>
                      </div>
                      <RemoveButton id={item.id} action="item" label="Remove" />
                    </div>
                    <details className="mt-2">
                      <summary className="inline-block cursor-pointer list-none text-xs text-muted hover:text-accent">
                        Edit
                      </summary>
                      <div className="mt-3">
                        <ItemForm
                          compact
                          values={{
                            id: item.id,
                            skillId: skill.id,
                            title: item.title,
                            kind: item.kind,
                            status: item.status,
                            due: item.due ?? "",
                            url: item.url ?? "",
                          }}
                        />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}

            <details className="mt-4 border-t border-line pt-4">
              <summary className="inline-block cursor-pointer list-none rounded-[--radius-control] border border-line-strong px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">
                Add an item
              </summary>
              <div className="mt-3">
                <ItemForm
                  values={{ skillId: skill.id, title: "", kind: "course", status: "queued", due: "", url: "" }}
                />
              </div>
            </details>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title={`Practice log (${practice.length})`}>
            {practice.length === 0 ? (
              <p className="text-sm text-muted">No practice logged yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {practice.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted">
                        {entry.day} · {formatMinutes(entry.minutes)}
                      </p>
                      {entry.note ? <p className="text-xs text-ink">{entry.note}</p> : null}
                    </div>
                    <RemoveButton id={entry.id} action="practice" label="×" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Details">
            <SkillForm
              values={{
                id: skill.id,
                name: skill.name,
                currentLevel: String(skill.currentLevel),
                targetLevel: String(skill.targetLevel),
                why: skill.why ?? "",
              }}
            />
            <div className="mt-4 border-t border-line pt-4">
              <DeleteSkill id={skill.id} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
