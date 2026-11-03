import { describe, expect, it } from "vitest";
import { dueBounds, filtersToQuery, hasActiveFilters, parseFilters } from "../src/modules/work/filters";

const TODAY = "2026-11-02";

describe("parseFilters", () => {
  it("defaults to the open tasks on the board view", () => {
    expect(parseFilters({})).toEqual({
      view: "board",
      board: null,
      arena: "any",
      priority: "any",
      due: "any",
      status: "open",
      task: null,
    });
  });

  it("reads every filter", () => {
    expect(
      parseFilters({ view: "list", board: "b1", arena: "basketball", priority: "high", due: "overdue", status: "any", task: "t1" }),
    ).toEqual({
      view: "list",
      board: "b1",
      arena: "basketball",
      priority: "high",
      due: "overdue",
      status: "any",
      task: "t1",
    });
  });

  it("falls back to the default for anything it does not know", () => {
    const filters = parseFilters({ view: "kanban", arena: "work", priority: "medium", due: "soon", status: "archived" });
    expect(filters).toMatchObject({ view: "board", arena: "any", priority: "any", due: "any", status: "open" });
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseFilters({ arena: ["family", "misc"] }).arena).toBe("family");
  });
});

describe("hasActiveFilters", () => {
  it("is false for the defaults and true once anything narrows", () => {
    const base = parseFilters({});
    expect(hasActiveFilters(base)).toBe(false);
    expect(hasActiveFilters({ ...base, arena: "family" })).toBe(true);
    expect(hasActiveFilters({ ...base, due: "overdue" })).toBe(true);
    expect(hasActiveFilters({ ...base, status: "any" })).toBe(true);
    // The view, the board and an open drawer are not filters.
    expect(hasActiveFilters({ ...base, view: "list", board: "b1", task: "t1" })).toBe(false);
  });
});

describe("dueBounds", () => {
  it("maps each window to calendar bounds around today", () => {
    expect(dueBounds("any", TODAY)).toEqual({ kind: "any" });
    expect(dueBounds("none", TODAY)).toEqual({ kind: "none" });
    expect(dueBounds("overdue", TODAY)).toEqual({ kind: "range", from: null, to: "2026-11-01" });
    expect(dueBounds("today", TODAY)).toEqual({ kind: "range", from: TODAY, to: TODAY });
    expect(dueBounds("week", TODAY)).toEqual({ kind: "range", from: TODAY, to: "2026-11-09" });
  });

  it("keeps overdue and today from overlapping", () => {
    const overdue = dueBounds("overdue", TODAY);
    expect(overdue).toMatchObject({ to: "2026-11-01" });
    expect(dueBounds("today", TODAY)).toMatchObject({ from: TODAY });
  });
});

describe("filtersToQuery", () => {
  it("writes nothing for the defaults", () => {
    expect(filtersToQuery(parseFilters({}))).toBe("");
  });

  it("changes one filter and leaves the rest", () => {
    const filters = parseFilters({ arena: "family", view: "list" });
    expect(filtersToQuery(filters, { due: "overdue" })).toBe("?view=list&arena=family&due=overdue");
  });

  it("drops a filter put back to its default", () => {
    expect(filtersToQuery(parseFilters({ arena: "family" }), { arena: "any" })).toBe("");
  });

  it("closes the drawer when task is cleared", () => {
    const filters = parseFilters({ task: "t1", board: "b1" });
    expect(filtersToQuery(filters, { task: null })).toBe("?board=b1");
  });
});
