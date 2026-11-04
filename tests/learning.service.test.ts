import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client";
import { digests, learningItems, practiceLog, skills } from "../src/db/schema";
import { latestDigest, listSkills } from "../src/modules/learning/queries";
import { renderReview } from "../src/modules/learning/render";
import { createItem, createSkill, logPractice, writeLearningReview } from "../src/modules/learning/service";
import type { SummaryModel } from "../src/modules/learning/summary";
import { freshDb } from "./helpers/db";

const TODAY = "2026-11-08"; // a Sunday
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.delete(digests);
  await db.delete(practiceLog);
  await db.delete(learningItems);
  await db.delete(skills);
});

async function makeSkill(name = "TypeScript") {
  const result = await createSkill(db, { name, currentLevel: 3, targetLevel: 5, why: "Ship faster" });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("logging practice", () => {
  it("updates the 7-day total immediately", async () => {
    // PRD §8.7's acceptance criterion.
    const skill = await makeSkill();
    expect((await listSkills(db, TODAY))[0]).toMatchObject({ last7: 0, last30: 0 });

    await logPractice(db, { skillId: skill.id, day: TODAY, minutes: 30, note: null });

    expect((await listSkills(db, TODAY))[0]).toMatchObject({ last7: 30, last30: 30 });
  });

  it("adds a second session rather than replacing the first", async () => {
    const skill = await makeSkill();
    await logPractice(db, { skillId: skill.id, day: TODAY, minutes: 30, note: "morning" });
    await logPractice(db, { skillId: skill.id, day: TODAY, minutes: 15, note: "evening" });

    expect((await listSkills(db, TODAY))[0]?.last7).toBe(45);
    expect(await db.select().from(practiceLog)).toHaveLength(2);
  });

  it("counts the 7-day window inclusively and leaves older practice to the 30", async () => {
    const skill = await makeSkill();
    await logPractice(db, { skillId: skill.id, day: TODAY, minutes: 10, note: null });
    await logPractice(db, { skillId: skill.id, day: "2026-11-02", minutes: 20, note: null }); // 6 days ago
    await logPractice(db, { skillId: skill.id, day: "2026-11-01", minutes: 40, note: null }); // 7 days ago
    await logPractice(db, { skillId: skill.id, day: "2026-10-11", minutes: 80, note: null }); // 28 days ago
    await logPractice(db, { skillId: skill.id, day: "2026-09-01", minutes: 999, note: null }); // outside 30

    const [summary] = await listSkills(db, TODAY);
    expect(summary?.last7).toBe(30);
    expect(summary?.last30).toBe(150);
  });

  it("refuses nonsense rather than storing it", async () => {
    const skill = await makeSkill();
    for (const minutes of [0, -30, 2000, 1.5]) {
      expect((await logPractice(db, { skillId: skill.id, day: TODAY, minutes, note: null })).ok, String(minutes)).toBe(
        false,
      );
    }
    expect(await db.select().from(practiceLog)).toHaveLength(0);
  });
});

describe("skills", () => {
  it("refuses a second skill with the same name", async () => {
    await makeSkill();
    expect(await createSkill(db, { name: "TypeScript", currentLevel: 1, targetLevel: 2, why: null })).toMatchObject({
      ok: false,
      error: { code: "duplicate" },
    });
  });

  it("takes its items and practice with it when deleted", async () => {
    const skill = await makeSkill();
    await createItem(db, { skillId: skill.id, title: "A book", kind: "book", status: "active", due: null, url: null });
    await logPractice(db, { skillId: skill.id, day: TODAY, minutes: 30, note: null });

    await db.delete(skills).where(eq(skills.id, skill.id));
    expect(await db.select().from(learningItems)).toHaveLength(0);
    expect(await db.select().from(practiceLog)).toHaveLength(0);
  });
});

describe("writeLearningReview", () => {
  async function seed() {
    const ts = await makeSkill("TypeScript");
    const shooting = await makeSkill("Shooting form");
    await createItem(db, {
      skillId: ts.id,
      title: "Effective TypeScript",
      kind: "book",
      status: "active",
      due: null,
      url: null,
    });
    await createItem(db, {
      skillId: shooting.id,
      title: "Form drills",
      kind: "project",
      status: "queued",
      due: "2026-11-01",
      url: null,
    });
    await logPractice(db, { skillId: ts.id, day: "2026-11-03", minutes: 45, note: null });
    await logPractice(db, { skillId: ts.id, day: "2026-10-28", minutes: 60, note: null });
    return { ts, shooting };
  }

  it("stores one row with the offline text when there is no model", async () => {
    await seed();
    const result = await writeLearningReview(db, TODAY, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.source).toBe("offline");

    const stored = await latestDigest(db, "learning_review");
    expect(stored).toMatchObject({ kind: "learning_review", day: TODAY, source: "offline", createdBy: "automation" });
    expect(stored?.body).toBe(renderReview(result.data.review));
    expect(stored?.body).toContain("45m this week");
  });

  it("keeps the computed structure alongside the text", async () => {
    await seed();
    await writeLearningReview(db, TODAY, null);
    const stored = await latestDigest(db, "learning_review");
    expect(stored?.data).toMatchObject({ weekStart: "2026-11-02", weekEnd: "2026-11-08" });
  });

  it("updates one row when it runs twice on the same day", async () => {
    await seed();
    await writeLearningReview(db, TODAY, null);
    await logPractice(db, { skillId: (await db.select().from(skills))[0]!.id, day: TODAY, minutes: 30, note: null });
    await writeLearningReview(db, TODAY, null);

    const rows = await db.select().from(digests);
    expect(rows).toHaveLength(1);
    // And it reflects the newer data rather than the first run's.
    expect(rows[0]?.body).toContain("1h 15m this week");
  });

  it("uses the model when one is given, and records that it did", async () => {
    await seed();
    const model: SummaryModel = { async write() { return "A steady week on TypeScript; shooting form needs a start."; } };

    const result = await writeLearningReview(db, TODAY, model);
    expect(result.ok && result.data.source).toBe("model");
    const stored = await latestDigest(db, "learning_review");
    expect(stored?.source).toBe("model");
    expect(stored?.body).toContain("A steady week");
  });

  it("stores the offline text when the model fails, rather than nothing", async () => {
    await seed();
    const model: SummaryModel = { async write() { throw new Error("no"); } };

    const result = await writeLearningReview(db, TODAY, model);
    expect(result.ok && result.data.source).toBe("offline");
    const stored = await latestDigest(db, "learning_review");
    expect(stored?.body).toContain("Learning review");
  });

  it("writes something sensible with nothing tracked at all", async () => {
    const result = await writeLearningReview(db, TODAY, null);
    expect(result.ok).toBe(true);
    expect((await latestDigest(db, "learning_review"))?.body).toContain("No skills are being tracked yet");
  });
});

describe("the learning-review job", () => {
  it("runs the real handler on a Sunday evening and stores a review", async () => {
    await makeSkill("TypeScript");
    const { JOBS } = await import("../src/modules/jobs/registry");
    const { runJob } = await import("../src/modules/jobs/service");

    const definition = JOBS.find((job) => job.name === "learning-review")!;
    // 23:30 UTC on Sunday 2026-11-08 is 18:30 in New York.
    const now = new Date("2026-11-08T23:30:00Z");
    const run = await runJob(definition, { db, timeZone: "America/New_York", now });

    expect(run.status).toBe("ok");
    expect(run.detail).toContain("1 skill(s)");
    expect((await latestDigest(db, "learning_review"))?.day).toBe("2026-11-08");
  });

  it("is only due on a Sunday after 18:00", async () => {
    const { JOBS } = await import("../src/modules/jobs/registry");
    const { isJobDue } = await import("../src/modules/jobs/schedule");
    const definition = JOBS.find((job) => job.name === "learning-review")!;
    const zone = "America/New_York";

    // Sunday 18:30 local, Sunday 16:00 local, and Wednesday evening.
    expect(isJobDue(definition.schedule, null, new Date("2026-11-08T23:30:00Z"), zone)).toBe(true);
    expect(isJobDue(definition.schedule, null, new Date("2026-11-08T21:00:00Z"), zone)).toBe(false);
    expect(isJobDue(definition.schedule, null, new Date("2026-11-04T23:30:00Z"), zone)).toBe(false);
  });
});
