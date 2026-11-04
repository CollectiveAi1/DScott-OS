import { describe, expect, it } from "vitest";
import { addBusinessDays } from "../src/modules/crm/dates";
import { dealState, needsAttention } from "../src/modules/crm/deal-state";
import { centsToInput, formatCents, formatCentsShort, parseMoney } from "../src/modules/crm/money";

describe("parseMoney", () => {
  it("reads the PRD's own example", () => {
    expect(parseMoney("$1,250")).toEqual({ ok: true, cents: 125000 });
  });

  it("reads the forms a person actually types", () => {
    expect(parseMoney("1250")).toEqual({ ok: true, cents: 125000 });
    expect(parseMoney("1,250")).toEqual({ ok: true, cents: 125000 });
    expect(parseMoney("1250.00")).toEqual({ ok: true, cents: 125000 });
    expect(parseMoney("$1,250.50")).toEqual({ ok: true, cents: 125050 });
    expect(parseMoney("  $ 1,250.5 ")).toEqual({ ok: true, cents: 125050 });
    expect(parseMoney("0.99")).toEqual({ ok: true, cents: 99 });
  });

  it("treats an empty value as nothing, not as an error", () => {
    expect(parseMoney("")).toEqual({ ok: true, cents: 0 });
    expect(parseMoney("   ")).toEqual({ ok: true, cents: 0 });
  });

  it("reads a negative, written either way", () => {
    expect(parseMoney("-250")).toEqual({ ok: true, cents: -25000 });
    expect(parseMoney("($250)")).toEqual({ ok: true, cents: -25000 });
  });

  it("refuses what it cannot read rather than rounding it into something plausible", () => {
    for (const input of ["abc", "$abc", "1,2.3.4", "12.345", "1 250 kr", "--5"]) {
      expect(parseMoney(input).ok, input).toBe(false);
    }
  });

  it("refuses an amount too large to hold exactly", () => {
    expect(parseMoney("99999999999999999999").ok).toBe(false);
  });
});

describe("formatting", () => {
  it("renders cents as money", () => {
    expect(formatCents(125000)).toBe("$1,250.00");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(99)).toBe("$0.99");
  });

  it("drops the trailing zeroes on a round number for a card", () => {
    expect(formatCentsShort(125000)).toBe("$1,250");
    expect(formatCentsShort(125050)).toBe("$1,250.50");
  });

  it("round-trips through the input and back", () => {
    for (const cents of [0, 99, 125000, 125050, 100]) {
      const back = parseMoney(centsToInput(cents));
      expect(back.ok && back.cents, String(cents)).toBe(cents);
    }
  });
});

describe("addBusinessDays", () => {
  it("skips the weekend", () => {
    // 2026-11-05 is a Thursday: two business days is the following Monday.
    expect(addBusinessDays("2026-11-05", 2)).toBe("2026-11-09");
    // Friday + 2 is Tuesday.
    expect(addBusinessDays("2026-11-06", 2)).toBe("2026-11-10");
  });

  it("works mid-week without skipping anything", () => {
    // Monday + 2 is Wednesday.
    expect(addBusinessDays("2026-11-02", 2)).toBe("2026-11-04");
  });

  it("starts counting from the next day when it begins on a weekend", () => {
    // Saturday + 2 lands on Tuesday: Monday is one, Tuesday is two.
    expect(addBusinessDays("2026-11-07", 2)).toBe("2026-11-10");
    expect(addBusinessDays("2026-11-08", 2)).toBe("2026-11-10");
  });

  it("returns the same day for zero", () => {
    expect(addBusinessDays("2026-11-05", 0)).toBe("2026-11-05");
  });

  it("crosses a month boundary", () => {
    // Monday 2026-11-30 + 2 is Wednesday 2026-12-02.
    expect(addBusinessDays("2026-11-30", 2)).toBe("2026-12-02");
  });
});

describe("dealState", () => {
  const TODAY = "2026-11-04";

  it("flags a deal with no next step", () => {
    expect(dealState({ nextStep: null, nextStepDue: null }, TODAY)).toMatchObject({ label: "No next step" });
    expect(dealState({ nextStep: "   ", nextStepDue: "2026-12-01" }, TODAY)).toMatchObject({ label: "No next step" });
  });

  it("flags a next step that is past due", () => {
    expect(dealState({ nextStep: "Send the quote", nextStepDue: "2026-11-03" }, TODAY)).toMatchObject({
      label: "Overdue",
    });
  });

  it("is content with a next step due today or later", () => {
    expect(dealState({ nextStep: "Send the quote", nextStepDue: TODAY }, TODAY).kind).toBe("ok");
    expect(dealState({ nextStep: "Send the quote", nextStepDue: "2026-12-01" }, TODAY).kind).toBe("ok");
  });

  it("treats an undated next step as a next step, not as late", () => {
    expect(dealState({ nextStep: "Chase it", nextStepDue: null }, TODAY).kind).toBe("ok");
  });

  it("says which cards want attention", () => {
    expect(needsAttention(dealState({ nextStep: null, nextStepDue: null }, TODAY))).toBe(true);
    expect(needsAttention(dealState({ nextStep: "Call", nextStepDue: null }, TODAY))).toBe(false);
  });
});
