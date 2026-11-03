import { describe, expect, it } from "vitest";
import { addDays } from "../src/lib/dates";
import { parseCapture } from "../src/modules/work/capture";

// 2026-11-02 is a Monday.
const MONDAY = "2026-11-02";

function parsed(input: string, today = MONDAY) {
  const result = parseCapture(input, today);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`);
  return result.capture;
}

describe("parseCapture · the PRD's own example", () => {
  it("reads arena, priority and due, and strips them from the title", () => {
    expect(parsed("Call coach re: film session #basketball !high due:tomorrow")).toEqual({
      title: "Call coach re: film session",
      arena: "basketball",
      priority: "high",
      due: "2026-11-03",
    });
  });
});

describe("parseCapture · defaults", () => {
  it("is a misc, normal-priority, undated task when nothing is tagged", () => {
    expect(parsed("Buy new laces")).toEqual({
      title: "Buy new laces",
      arena: "misc",
      priority: "normal",
      due: null,
    });
  });
});

describe("parseCapture · arena", () => {
  it("accepts every arena", () => {
    for (const arena of ["collective", "basketball", "family", "misc"] as const) {
      expect(parsed(`Something #${arena}`).arena).toBe(arena);
    }
  });

  it("leaves a tag that is not an arena in the title", () => {
    const capture = parsed("Ship #kinetic landing page");
    expect(capture.title).toBe("Ship #kinetic landing page");
    expect(capture.arena).toBe("misc");
  });
});

describe("parseCapture · priority", () => {
  it("accepts every level", () => {
    for (const priority of ["urgent", "high", "normal", "low"] as const) {
      expect(parsed(`Something !${priority}`).priority).toBe(priority);
    }
  });

  it("leaves an unknown level in the title", () => {
    expect(parsed("Fix this !asap").title).toBe("Fix this !asap");
    expect(parsed("Fix this !asap").priority).toBe("normal");
  });
});

describe("parseCapture · due", () => {
  it("reads an explicit date", () => {
    expect(parsed("Pay invoice due:2026-12-01").due).toBe("2026-12-01");
  });

  it("reads today and tomorrow in the given day's terms", () => {
    expect(parsed("A due:today").due).toBe(MONDAY);
    expect(parsed("A due:tomorrow").due).toBe("2026-11-03");
  });

  it("counts today as the next occurrence of its own weekday", () => {
    // Monday the 2nd: due:mon means today, not a week out.
    expect(parsed("A due:mon").due).toBe("2026-11-02");
    expect(parsed("A due:tue").due).toBe("2026-11-03");
    expect(parsed("A due:sun").due).toBe("2026-11-08");
  });

  it("crosses a month boundary", () => {
    // Saturday 2026-11-28 → the next Wednesday is 2026-12-02.
    expect(parsed("A due:wed", "2026-11-28").due).toBe("2026-12-02");
  });

  it("resolves every weekday from every weekday", () => {
    // Mon 2026-11-02 through Sun 2026-11-08.
    const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
    const names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    week.forEach((today, todayIndex) => {
      names.forEach((name, nameIndex) => {
        // 0 days ahead when it is today's own weekday, otherwise however many days until it.
        const expected = addDays(today, (nameIndex - todayIndex + 7) % 7);
        expect(parsed(`A due:${name}`, today).due, `due:${name} on ${today}`).toBe(expected);
      });
    });
  });

  it("leaves a due it cannot read in the title", () => {
    expect(parsed("Renew domain due:whenever")).toMatchObject({
      title: "Renew domain due:whenever",
      due: null,
    });
    expect(parsed("Renew domain due:2026-13-45")).toMatchObject({
      title: "Renew domain due:2026-13-45",
      due: null,
    });
  });
});

describe("parseCapture · token handling", () => {
  it("reads tokens anywhere in the line", () => {
    expect(parsed("#family due:today Pick up Maya !urgent from practice")).toEqual({
      title: "Pick up Maya from practice",
      arena: "family",
      priority: "urgent",
      due: MONDAY,
    });
  });

  it("ignores case", () => {
    expect(parsed("Thing #BasketBall !HIGH DUE:Tomorrow")).toMatchObject({
      arena: "basketball",
      priority: "high",
      due: "2026-11-03",
    });
  });

  it("lets the last token of a kind win, so you can correct yourself", () => {
    expect(parsed("Thing #family #collective !low !urgent due:today due:tomorrow")).toMatchObject({
      arena: "collective",
      priority: "urgent",
      due: "2026-11-03",
    });
  });

  it("collapses the whitespace tokens leave behind", () => {
    expect(parsed("Email   Ahmad   #collective   about Q1").title).toBe("Email Ahmad about Q1");
  });

  it("does not strip a token glued to a word", () => {
    expect(parsed("Review the C#collective proposal").title).toBe("Review the C#collective proposal");
  });
});

describe("parseCapture · refusals", () => {
  it("refuses an empty line, or one that is only tokens", () => {
    for (const input of ["", "   ", "#basketball !high due:today"]) {
      const result = parseCapture(input, MONDAY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("Type something to capture.");
    }
  });

  it("caps a very long title", () => {
    expect(parsed("x".repeat(500)).title).toHaveLength(200);
  });
});
