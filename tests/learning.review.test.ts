import { describe, expect, it } from "vitest";
import { buildReview, STALLED_DAYS, type ReviewItem, type ReviewPractice, type ReviewSkill } from "../src/modules/learning/review";

// 2026-11-08 is a Sunday. Its week is Mon 2026-11-02 to Sun 2026-11-08.
const SUNDAY = "2026-11-08";

const SKILLS: ReviewSkill[] = [
  { id: "s1", name: "TypeScript", currentLevel: 3, targetLevel: 5 },
  { id: "s2", name: "Shooting form", currentLevel: 2, targetLevel: 4 },
];

function review(input: {
  skills?: ReviewSkill[];
  items?: ReviewItem[];
  practice?: ReviewPractice[];
  today?: string;
}) {
  return buildReview({
    today: input.today ?? SUNDAY,
    skills: input.skills ?? SKILLS,
    items: input.items ?? [],
    practice: input.practice ?? [],
  });
}

const item = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "i1",
  skillId: "s1",
  title: "Effective TypeScript",
  kind: "book",
  status: "active",
  due: null,
  ...overrides,
});

describe("the week it covers", () => {
  it("is the Monday–Sunday block containing the day", () => {
    const result = review({});
    expect(result.weekStart).toBe("2026-11-02");
    expect(result.weekEnd).toBe("2026-11-08");
  });

  it("is the same block when run mid-week", () => {
    const result = review({ today: "2026-11-04" });
    expect(result.weekStart).toBe("2026-11-02");
    expect(result.weekEnd).toBe("2026-11-08");
  });
});

describe("minutes per skill", () => {
  it("compares this week against last week", () => {
    const practice: ReviewPractice[] = [
      // This week.
      { skillId: "s1", day: "2026-11-03", minutes: 30 },
      { skillId: "s1", day: "2026-11-05", minutes: 45 },
      // Last week (Mon 2026-10-26 to Sun 2026-11-01).
      { skillId: "s1", day: "2026-10-28", minutes: 60 },
      // The week before that: counted in neither.
      { skillId: "s1", day: "2026-10-20", minutes: 90 },
    ];
    const result = review({ practice });
    const skill = result.skills.find((row) => row.skillId === "s1")!;
    expect(skill.thisWeek).toBe(75);
    expect(skill.lastWeek).toBe(60);
  });

  it("sums two sessions on the same day rather than taking one", () => {
    const practice: ReviewPractice[] = [
      { skillId: "s1", day: "2026-11-03", minutes: 30 },
      { skillId: "s1", day: "2026-11-03", minutes: 15 },
    ];
    expect(review({ practice }).skills[0]?.thisWeek).toBe(45);
  });

  it("totals across every skill", () => {
    const practice: ReviewPractice[] = [
      { skillId: "s1", day: "2026-11-03", minutes: 30 },
      { skillId: "s2", day: "2026-11-04", minutes: 20 },
      { skillId: "s1", day: "2026-10-28", minutes: 10 },
    ];
    const result = review({ practice });
    expect(result.totals).toEqual({ thisWeek: 50, lastWeek: 10 });
  });

  it("is zero for a skill with no practice, not missing", () => {
    const result = review({});
    expect(result.skills).toHaveLength(2);
    expect(result.skills[1]).toMatchObject({ thisWeek: 0, lastWeek: 0, daysSincePractice: null });
  });

  it("reports how long it has been since the last practice", () => {
    const practice: ReviewPractice[] = [{ skillId: "s1", day: "2026-11-05", minutes: 30 }];
    expect(review({ practice }).skills[0]?.daysSincePractice).toBe(3);
  });

  it("ignores practice logged after the review day", () => {
    const practice: ReviewPractice[] = [{ skillId: "s1", day: "2026-11-20", minutes: 30 }];
    expect(review({ practice }).skills[0]?.daysSincePractice).toBeNull();
  });
});

describe("stalled", () => {
  const practiceDaysAgo = (days: number): ReviewPractice[] => {
    const day = new Date(Date.parse(`${SUNDAY}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    return [{ skillId: "s1", day, minutes: 30 }];
  };

  it("flags an active item whose skill has not been practised for two weeks", () => {
    const result = review({ items: [item()], practice: practiceDaysAgo(STALLED_DAYS) });
    expect(result.stalled.map((flagged) => flagged.title)).toEqual(["Effective TypeScript"]);
    expect(result.stalled[0]?.skillName).toBe("TypeScript");
  });

  it("leaves alone a skill practised a day inside the window", () => {
    const result = review({ items: [item()], practice: practiceDaysAgo(STALLED_DAYS - 1) });
    expect(result.stalled).toEqual([]);
  });

  it("flags an active item on a skill never practised at all", () => {
    expect(review({ items: [item()] }).stalled).toHaveLength(1);
  });

  it("only flags active items, not queued, done or dropped ones", () => {
    const items = [
      item({ id: "a", status: "active" }),
      item({ id: "q", status: "queued" }),
      item({ id: "d", status: "done" }),
      item({ id: "x", status: "dropped" }),
    ];
    expect(review({ items }).stalled.map((flagged) => flagged.itemId)).toEqual(["a"]);
  });
});

describe("past due", () => {
  it("flags an item whose due date has gone", () => {
    const result = review({ items: [item({ due: "2026-11-01" })] });
    expect(result.pastDue.map((flagged) => flagged.title)).toEqual(["Effective TypeScript"]);
  });

  it("ignores one due today or later", () => {
    expect(review({ items: [item({ due: SUNDAY })] }).pastDue).toEqual([]);
    expect(review({ items: [item({ due: "2026-12-01" })] }).pastDue).toEqual([]);
  });

  it("ignores an item already done or dropped", () => {
    const items = [
      item({ id: "d", status: "done", due: "2026-11-01" }),
      item({ id: "x", status: "dropped", due: "2026-11-01" }),
    ];
    expect(review({ items }).pastDue).toEqual([]);
  });

  it("includes a queued item that has gone past its date", () => {
    expect(review({ items: [item({ status: "queued", due: "2026-11-01" })] }).pastDue).toHaveLength(1);
  });
});

describe("the next-step ladder", () => {
  const stepFor = (items: ReviewItem[], practice: ReviewPractice[] = []) =>
    review({ items, practice }).skills.find((skill) => skill.skillId === "s1")!.nextStep;

  const fresh: ReviewPractice[] = [{ skillId: "s1", day: "2026-11-07", minutes: 30 }];

  it("1 · past due wins over everything", () => {
    const items = [item({ id: "a", status: "active" }), item({ id: "o", status: "queued", due: "2026-11-01", title: "Overdue course" })];
    expect(stepFor(items, fresh)).toBe('Finish "Overdue course", it was due 2026-11-01.');
  });

  it("2 · an active item on a stalled skill asks him back", () => {
    expect(stepFor([item()])).toBe('Get back to "Effective TypeScript".');
  });

  it("3 · an active item on a live skill says keep going", () => {
    expect(stepFor([item()], fresh)).toBe('Keep going on "Effective TypeScript".');
  });

  it("4 · nothing active but something queued says start it", () => {
    expect(stepFor([item({ status: "queued", title: "Type-Level TypeScript" })], fresh)).toBe(
      'Start "Type-Level TypeScript".',
    );
  });

  it("5 · everything finished asks for something new", () => {
    const items = [item({ id: "d", status: "done" }), item({ id: "x", status: "dropped" })];
    expect(stepFor(items, fresh)).toBe("Pick something new for TypeScript.");
  });

  it("6 · a skill with no items asks for one", () => {
    expect(stepFor([], fresh)).toBe("Add something to learn for TypeScript.");
  });

  it("gives exactly one step per skill, always", () => {
    const result = review({ items: [item(), item({ id: "i2", skillId: "s2", status: "queued" })] });
    expect(result.skills).toHaveLength(2);
    for (const skill of result.skills) expect(skill.nextStep).toMatch(/\S/);
  });
});

describe("an empty record", () => {
  it("is a review with nothing in it, not a failure", () => {
    const result = buildReview({ today: SUNDAY, skills: [], items: [], practice: [] });
    expect(result).toMatchObject({ totals: { thisWeek: 0, lastWeek: 0 }, skills: [], stalled: [], pastDue: [] });
  });
});
