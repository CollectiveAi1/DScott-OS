import { describe, expect, it } from "vitest";
import { toolSchemas, writeToolNames } from "../src/modules/operator/registry";
import { TOOLS } from "../src/modules/operator/tools";

/**
 * The lists below are the Operator's boundary, written down.
 *
 * SPEC-009 §3.2: no tool deletes a row, sends anything, reaches an external service, or reads or
 * writes settings, the owner record or stored keys. A new tool — and especially a new tool that
 * writes — fails this suite until someone edits these lists on purpose. That is the point.
 */
const EVERY_TOOL = [
  "brief.today",
  "capture",
  "contacts.add_note",
  "contacts.search",
  "contacts.timeline",
  "deals.move_stage",
  "deals.pipeline_summary",
  "deals.stale",
  "learning.log_practice",
  "learning.summary",
  "messages.draft",
  "schedule.conflicts",
  "schedule.create_event",
  "schedule.free_slots",
  "schedule.range",
  "tasks.complete",
  "tasks.create",
  "tasks.search",
];

const WRITE_TOOLS = [
  "capture",
  "contacts.add_note",
  "deals.move_stage",
  "learning.log_practice",
  "messages.draft",
  "schedule.create_event",
  "tasks.complete",
  "tasks.create",
];

describe("the tool registry", () => {
  it("is exactly the tools the spec lists", () => {
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual(EVERY_TOOL);
  });

  it("has exactly these tools that can change a row", () => {
    expect(writeToolNames(TOOLS)).toEqual(WRITE_TOOLS);
  });

  it("has no tool whose name suggests it sends, deletes or configures", () => {
    for (const name of TOOLS.map((tool) => tool.name)) {
      expect(name).not.toMatch(/delete|remove|send|deliver|approve|settings|secret|key|token|disconnect/i);
    }
  });

  it("names every tool uniquely", () => {
    expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
  });

  it("describes every tool for the model", () => {
    for (const tool of TOOLS) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
    }
  });

  it("says plainly in messages.draft that nothing is sent", () => {
    const draft = TOOLS.find((tool) => tool.name === "messages.draft");
    expect(draft?.description).toMatch(/NOT sent/);
    expect(draft?.description).toMatch(/never say it was sent/i);
  });

  it("turns every tool into a JSON schema the API can take", () => {
    const schemas = toolSchemas(TOOLS);
    expect(schemas).toHaveLength(TOOLS.length);
    for (const schema of schemas) {
      expect(schema.input_schema.type, schema.name).toBe("object");
      expect(schema.description.length, schema.name).toBeGreaterThan(40);
    }
  });

  it("rejects input that does not match a tool's schema", () => {
    const create = TOOLS.find((tool) => tool.name === "schedule.create_event");
    expect(create?.input.safeParse({ title: "x", arena: "basketball", kind: "game", date: "Thursday" }).success).toBe(false);
    expect(
      create?.input.safeParse({ title: "x", arena: "basketball", kind: "game", date: "2026-11-12", start: "19:00", end: "21:00" })
        .success,
    ).toBe(true);
  });
});
