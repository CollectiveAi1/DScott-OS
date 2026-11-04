import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkbox, issueToMessage, optionalDate, optionalId, optionalText, optionalTime } from "../src/lib/form-fields";

/**
 * The bug these exist to stop, three times over: a browser posts **no key at all** for a control
 * it did not render, or for an unchecked box. A schema that only tolerates an empty string fails
 * on exactly the fields nobody saw.
 */
const schema = z.object({
  note: optionalText,
  due: optionalDate,
  at: optionalTime,
  linked: optionalId,
  agreed: checkbox,
});

const UUID = "7b0d5255-f247-4802-8694-529759982334";

describe("optional fields · an absent key is the same as an empty one", () => {
  it("accepts a form where none of them were rendered", () => {
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ note: null, due: null, at: null, linked: null, agreed: false });
  });

  it("accepts a form where they were rendered and left blank", () => {
    const parsed = schema.safeParse({ note: "", due: "", at: "", linked: "" });
    expect(parsed.success && parsed.data).toMatchObject({ note: null, due: null, at: null, linked: null });
  });

  it("treats whitespace as blank", () => {
    expect(schema.safeParse({ note: "   " }).success).toBe(true);
    const parsed = schema.safeParse({ note: "   " });
    expect(parsed.success && parsed.data.note).toBeNull();
  });

  it("keeps a real value, trimmed", () => {
    const parsed = schema.safeParse({ note: "  hello  ", due: "2026-11-30", at: "18:00", linked: UUID });
    expect(parsed.success && parsed.data).toMatchObject({
      note: "hello",
      due: "2026-11-30",
      at: "18:00",
      linked: UUID,
    });
  });
});

describe("optional fields · still validate what is there", () => {
  it("refuses a malformed date, time or id", () => {
    expect(schema.safeParse({ due: "30/11/2026" }).success).toBe(false);
    expect(schema.safeParse({ at: "6pm" }).success).toBe(false);
    expect(schema.safeParse({ linked: "not-an-id" }).success).toBe(false);
  });
});

describe("checkbox", () => {
  it("is false when absent and true only when ticked", () => {
    expect(checkbox.parse(undefined)).toBe(false);
    expect(checkbox.parse(null)).toBe(false);
    expect(checkbox.parse("")).toBe(false);
    expect(checkbox.parse("off")).toBe(false);
    expect(checkbox.parse("on")).toBe(true);
    expect(checkbox.parse("true")).toBe(true);
  });
});

describe("issueToMessage", () => {
  const labels = { title: "title", nextStepDue: "next step date" };

  it("passes through a message written for the form", () => {
    const parsed = z.object({ title: z.string().min(1, "Give it a title.") }).safeParse({ title: "" });
    if (parsed.success) throw new Error("expected a failure");
    expect(issueToMessage(parsed.error, labels).error).toBe("Give it a title.");
  });

  it("names the field rather than leaking zod's own wording", () => {
    const parsed = z.object({ title: z.string() }).safeParse({});
    if (parsed.success) throw new Error("expected a failure");
    const message = issueToMessage(parsed.error, labels).error ?? "";
    expect(message).toBe("Check the title.");
    expect(message).not.toMatch(/nonoptional|undefined|Invalid input|Required/i);
  });

  it("falls back to something a person can read for an unlabelled field", () => {
    const parsed = z.object({ mystery: z.string() }).safeParse({});
    if (parsed.success) throw new Error("expected a failure");
    expect(issueToMessage(parsed.error, labels).error).toBe("Check the form.");
  });

  it("never shows raw zod wording, whichever field is missing", () => {
    for (const field of ["title", "nextStepDue", "mystery"]) {
      const parsed = z
        .object({ title: z.string(), nextStepDue: z.string(), mystery: z.string() })
        .safeParse(Object.fromEntries(["title", "nextStepDue", "mystery"].filter((key) => key !== field).map((key) => [key, "x"])));
      if (parsed.success) continue;
      const message = issueToMessage(parsed.error, labels).error ?? "";
      expect(message, field).not.toMatch(/nonoptional|received undefined|Invalid input|Required/i);
      expect(message.endsWith("."), field).toBe(true);
    }
  });
});
