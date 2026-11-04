import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth/session";
import { dateInZone } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { SkillForm, WriteReview } from "@/modules/learning/components/forms";
import { latestDigest, listSkills } from "@/modules/learning/queries";
import { formatMinutes } from "@/modules/learning/render";

export const metadata: Metadata = { title: "Learning" };

export default async function LearningPage() {
  await requireOwner();
  const db = getDb();
  const { timezone } = await getSettings();
  const today = dateInZone(new Date(), timezone);

  const [skills, review] = await Promise.all([listSkills(db, today), latestDigest(db, "learning_review")]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-3xl font-semibold">Learning</h1>

      <section aria-labelledby="review-heading" className="mb-10 rounded-[--radius-panel] border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="review-heading" className="text-lg font-semibold">
            Weekly review
          </h2>
          <span className="font-mono text-xs text-muted">
            {review ? `${review.day} · ${review.source === "model" ? "written up" : "offline template"}` : "Sundays after 18:00"}
          </span>
        </div>
        {review ? (
          <p className="whitespace-pre-wrap text-sm text-ink">{review.body}</p>
        ) : (
          <p className="text-sm text-muted">
            No review yet. One is written every Sunday evening, and you can ask for one now.
          </p>
        )}
        <div className="mt-4">
          <WriteReview />
        </div>
      </section>

      <section aria-labelledby="skills-heading" className="mb-10">
        <h2 id="skills-heading" className="mb-3 text-lg font-semibold">
          Skills
        </h2>
        {skills.length === 0 ? (
          <p className="rounded-[--radius-panel] border border-dashed border-line-strong px-4 py-6 text-sm text-muted">
            Nothing tracked yet. A skill is anything you want to be measurably better at.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-[--radius-panel] border border-line bg-surface">
            {skills.map((skill) => (
              <li key={skill.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/learning/${skill.id}`} className="text-sm text-ink hover:text-accent">
                    {skill.name}
                  </Link>
                  {skill.why ? <p className="text-xs text-muted">{skill.why}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-muted">
                  <span>
                    level {skill.currentLevel} → {skill.targetLevel}
                  </span>
                  <span className={skill.last7 > 0 ? "text-accent" : undefined}>{formatMinutes(skill.last7)} / 7d</span>
                  <span>{formatMinutes(skill.last30)} / 30d</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-skill-heading">
        <h2 id="new-skill-heading" className="mb-3 text-lg font-semibold">
          New skill
        </h2>
        <div className="rounded-[--radius-panel] border border-line bg-surface p-4">
          <SkillForm values={{ name: "", currentLevel: "1", targetLevel: "3", why: "" }} />
        </div>
      </section>
    </div>
  );
}
