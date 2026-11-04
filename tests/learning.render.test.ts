import { describe, expect, it } from "vitest";
import { formatMinutes, renderReview } from "../src/modules/learning/render";
import { buildReview, type ReviewItem, type ReviewPractice, type ReviewSkill } from "../src/modules/learning/review";
import { INSTRUCTIONS, summarise, type SummaryModel } from "../src/modules/learning/summary";

const SUNDAY = "2026-11-08";

const SKILLS: ReviewSkill[] = [
  { id: "s1", name: "TypeScript", currentLevel: 3, targetLevel: 5 },
  { id: "s2", name: "Shooting form", currentLevel: 2, targetLevel: 4 },
];

const ITEMS: ReviewItem[] = [
  { id: "i1", skillId: "s1", title: "Effective TypeScript", kind: "book", status: "active", due: null },
  { id: "i2", skillId: "s2", title: "Form shooting drills", kind: "project", status: "queued", due: "2026-11-01" },
];

const PRACTICE: ReviewPractice[] = [
  { skillId: "s1", day: "2026-11-03", minutes: 45 },
  { skillId: "s1", day: "2026-11-05", minutes: 30 },
  { skillId: "s1", day: "2026-10-28", minutes: 60 },
];

const fixture = () => buildReview({ today: SUNDAY, skills: SKILLS, items: ITEMS, practice: PRACTICE });

describe("formatMinutes", () => {
  it("reads the way a person says it", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(125)).toBe("2h 5m");
  });
});

describe("renderReview · determinism", () => {
  it("gives the same words for the same data, every time", () => {
    // PRD §8.7's acceptance criterion: the offline review is deterministic.
    const first = renderReview(fixture());
    const second = renderReview(fixture());
    expect(first).toBe(second);
  });

  it("reads as a whole, with the numbers that were computed", () => {
    const text = renderReview(fixture());
    expect(text).toContain("week of 2026-11-02 to 2026-11-08");
    // 45 + 30 this week against 60 last week.
    expect(text).toContain("You logged 1h 15m this week, up 15m on last week.");
    expect(text).toContain("TypeScript (level 3 of 5): 1h 15m this week");
    expect(text).toContain("Shooting form (level 2 of 4): 0m this week");
  });

  it("names what is past due and what has stalled", () => {
    const text = renderReview(fixture());
    expect(text).toContain("Form shooting drills (Shooting form) was due 2026-11-01.");
    // s2 has never been practised, but its only item is queued, so nothing is stalled.
    expect(text).not.toContain("Stalled");
  });

  it("includes a stalled section when an active item has gone quiet", () => {
    const items: ReviewItem[] = [{ ...ITEMS[0]!, skillId: "s2", status: "active" }];
    const text = renderReview(buildReview({ today: SUNDAY, skills: SKILLS, items, practice: [] }));
    expect(text).toContain("Stalled");
    expect(text).toContain("Shooting form has had no practice in two weeks.");
  });

  it("gives one next step per skill", () => {
    const text = renderReview(fixture());
    expect(text).toContain("TypeScript: Keep going on \"Effective TypeScript\".");
    expect(text).toContain("Shooting form: Finish \"Form shooting drills\", it was due 2026-11-01.");
  });

  it("says something useful when there is nothing tracked yet", () => {
    const text = renderReview(buildReview({ today: SUNDAY, skills: [], items: [], practice: [] }));
    expect(text).toContain("No skills are being tracked yet");
  });

  it("handles a week with no practice at all without claiming progress", () => {
    const text = renderReview(buildReview({ today: SUNDAY, skills: SKILLS, items: ITEMS, practice: [] }));
    expect(text).toContain("You logged 0m this week, nothing either week.");
    expect(text).not.toMatch(/up \d/);
  });

  it("says down when the week was thinner than the last", () => {
    const thin: ReviewPractice[] = [
      { skillId: "s1", day: "2026-11-03", minutes: 15 },
      { skillId: "s1", day: "2026-10-28", minutes: 60 },
    ];
    const text = renderReview(buildReview({ today: SUNDAY, skills: SKILLS, items: ITEMS, practice: thin }));
    expect(text).toContain("down 45m on last week");
  });
});

describe("summarise", () => {
  it("uses the offline template when there is no model", async () => {
    const result = await summarise(fixture(), null);
    expect(result.source).toBe("offline");
    expect(result.body).toBe(renderReview(fixture()));
  });

  it("hands the model the already-worked-out review and keeps what it writes", async () => {
    let seen: { instructions: string; review: string } | null = null;
    const model: SummaryModel = {
      async write(input) {
        seen = input;
        return "A good week on TypeScript: 1h 15m, a little up on last week.";
      },
    };

    const result = await summarise(fixture(), model);
    expect(result.source).toBe("model");
    expect(result.body).toBe("A good week on TypeScript: 1h 15m, a little up on last week.");
    expect(seen!.instructions).toBe(INSTRUCTIONS);
    expect(seen!.review).toContain("1h 15m");
  });

  it("falls back to the template when the model fails", async () => {
    const model: SummaryModel = {
      async write() {
        throw new Error("API unavailable");
      },
    };
    const result = await summarise(fixture(), model);
    expect(result.source).toBe("offline");
    expect(result.body).toBe(renderReview(fixture()));
  });

  it("falls back when the model returns nothing worth keeping", async () => {
    for (const reply of ["", "   ", "ok"]) {
      const result = await summarise(fixture(), { async write() { return reply; } });
      expect(result.source, reply).toBe("offline");
    }
  });

  it("tells the model the numbers are not its to compute", () => {
    expect(INSTRUCTIONS).toMatch(/already worked out/i);
    expect(INSTRUCTIONS).toMatch(/Do not calculate/i);
    expect(INSTRUCTIONS).toMatch(/do not invent/i);
  });
});
