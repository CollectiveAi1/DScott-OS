import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ModelReply, OperatorClient } from "../src/modules/operator/client";
import { MAX_ROUNDS, runTurn, summariseArgs } from "../src/modules/operator/loop";
import { ok, fail, type AnyTool, type ToolContext } from "../src/modules/operator/registry";

const ctx = { db: {}, timeZone: "America/New_York", today: "2026-11-10", now: new Date() } as unknown as ToolContext;

function reply(partial: Partial<ModelReply>): ModelReply {
  return { text: "", toolUses: [], usage: { input: 10, output: 5 }, stopReason: null, ...partial };
}

/** A client that returns scripted replies in order, and records what it was asked. */
function scripted(replies: ModelReply[]): OperatorClient & { seen: Parameters<OperatorClient["complete"]>[0][] } {
  const seen: Parameters<OperatorClient["complete"]>[0][] = [];
  let index = 0;
  return {
    seen,
    async complete(input) {
      seen.push(structuredClone({ system: input.system, turns: input.turns, tools: input.tools }));
      const next = replies[index++];
      if (!next) throw new Error("the stub ran out of scripted replies");
      return next;
    },
  };
}

const echo: AnyTool = {
  name: "echo",
  description: "x".repeat(50),
  effect: "read",
  input: z.object({ value: z.string() }),
  async run(_ctx, input) {
    return ok({ echoed: (input as { value: string }).value });
  },
};

const refuses: AnyTool = {
  name: "refuses",
  description: "x".repeat(50),
  effect: "write",
  input: z.object({}),
  async run() {
    return fail("do_not_contact", "This contact is marked do-not-contact.");
  },
};

const explodes: AnyTool = {
  name: "explodes",
  description: "x".repeat(50),
  effect: "write",
  input: z.object({}),
  async run() {
    throw new Error("boom");
  },
};

const tools = [echo, refuses, explodes];
const base = { tools, ctx, system: "system", history: [], text: "do the thing" };

describe("runTurn", () => {
  it("returns the answer when the model calls no tools", async () => {
    const client = scripted([reply({ text: "Done." })]);
    const result = await runTurn(client, base);
    expect(result).toMatchObject({ ok: true, data: { text: "Done.", calls: [], stopped: null } });
  });

  it("runs a scripted tool call and feeds the result back", async () => {
    const client = scripted([
      reply({ toolUses: [{ id: "u1", name: "echo", input: { value: "hello" } }] }),
      reply({ text: "It said hello." }),
    ]);

    const result = await runTurn(client, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).toBe("It said hello.");
    expect(result.data.calls).toEqual([
      { name: "echo", summary: "value: hello", status: "ok", input: { value: "hello" }, output: { echoed: "hello" } },
    ]);

    // The second call carries the assistant's tool_use and the tool result, in order.
    const second = client.seen[1];
    expect(second?.turns.map((turn) => turn.role)).toEqual(["user", "assistant", "tool"]);
  });

  it("adds every usage count across rounds", async () => {
    const client = scripted([
      reply({ toolUses: [{ id: "u1", name: "echo", input: { value: "a" } }] }),
      reply({ text: "ok" }),
    ]);
    const result = await runTurn(client, base);
    expect(result.ok && result.data.usage).toEqual({ input: 20, output: 10 });
  });

  it("hands a tool's refusal back to the model rather than ending the turn", async () => {
    const client = scripted([
      reply({ toolUses: [{ id: "u1", name: "refuses", input: {} }] }),
      reply({ text: "That contact is marked do-not-contact, so I did not draft anything." }),
    ]);

    const result = await runTurn(client, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.calls[0]).toMatchObject({
      status: "error",
      output: { error: "This contact is marked do-not-contact." },
    });
    expect(result.data.text).toContain("do-not-contact");
  });

  it("survives a tool that throws, and says nothing was changed", async () => {
    const client = scripted([
      reply({ toolUses: [{ id: "u1", name: "explodes", input: {} }] }),
      reply({ text: "That failed." }),
    ]);
    const result = await runTurn(client, base);
    expect(result.ok && result.data.calls[0]).toMatchObject({ name: "explodes", status: "error" });
    expect(result.ok && (result.data.calls[0]?.output as { error: string }).error).toContain("Nothing was changed");
  });

  it("refuses input that does not match the tool's schema, without running it", async () => {
    const run = vi.fn();
    const strict: AnyTool = { ...echo, name: "strict", run: run as never };
    const client = scripted([
      reply({ toolUses: [{ id: "u1", name: "strict", input: { value: 7 } }] }),
      reply({ text: "I need a string." }),
    ]);

    const result = await runTurn(client, { ...base, tools: [strict], text: "x" });
    expect(run).not.toHaveBeenCalled();
    expect(result.ok && result.data.calls[0]?.status).toBe("error");
    expect(result.ok && (result.data.calls[0]?.output as { error: string }).error).toContain("value");
  });

  it("tells the model when it asked for a tool that does not exist", async () => {
    const client = scripted([
      reply({ toolUses: [{ id: "u1", name: "settings.update", input: {} }] }),
      reply({ text: "I cannot do that." }),
    ]);
    const result = await runTurn(client, base);
    expect(result.ok && (result.data.calls[0]?.output as { error: string }).error).toBe(
      "There is no tool called settings.update.",
    );
  });

  it("stops after the round cap and says it stopped", async () => {
    const forever = Array.from({ length: MAX_ROUNDS + 2 }, () =>
      reply({ toolUses: [{ id: "u1", name: "echo", input: { value: "again" } }] }),
    );
    const result = await runTurn(scripted(forever), base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stopped).toBe("rounds");
    expect(result.data.calls).toHaveLength(MAX_ROUNDS);
    expect(result.data.text).toContain("stopped after the maximum number of steps");
  });

  it("stops when the turn runs out of time", async () => {
    let clock = 0;
    const client = scripted([
      reply({ toolUses: [{ id: "u1", name: "echo", input: { value: "a" } }] }),
      reply({ text: "never reached" }),
    ]);
    const result = await runTurn(client, {
      ...base,
      now: () => {
        clock += 40_000;
        return clock;
      },
    });
    expect(result.ok && result.data.stopped).toBe("time");
    expect(result.ok && result.data.text).toContain("ran out of time");
  });

  it("reports a model failure as a failed turn, not a half answer", async () => {
    const client: OperatorClient = {
      async complete() {
        throw new Error("503");
      },
    };
    const result = await runTurn(client, base);
    expect(result).toEqual({
      ok: false,
      error: { code: "model_failed", message: "The Operator could not reach the model just now. Try again." },
    });
  });

  it("reports each tool call as it finishes, so a thread can be written as it runs", async () => {
    const seen: string[] = [];
    const client = scripted([
      reply({ toolUses: [{ id: "u1", name: "echo", input: { value: "a" } }, { id: "u2", name: "refuses", input: {} }] }),
      reply({ text: "done" }),
    ]);
    await runTurn(client, {
      ...base,
      onToolCall: async (call) => {
        seen.push(`${call.name}:${call.status}`);
      },
    });
    expect(seen).toEqual(["echo:ok", "refuses:error"]);
  });

  it("gives the model every tool as a JSON schema", async () => {
    const client = scripted([reply({ text: "ok" })]);
    await runTurn(client, base);
    expect(client.seen[0]?.tools.map((tool) => tool.name)).toEqual(["echo", "refuses", "explodes"]);
  });
});

describe("summariseArgs", () => {
  it("never puts a message body or a note in the summary", () => {
    const summary = summariseArgs({ kind: "email", to: "rosa@example.com", subject: "Hi", body: "secret text" });
    expect(summary).toBe("kind: email, to: rosa@example.com");
    expect(summary).not.toContain("secret");
  });

  it("keeps at most three fields and truncates a long one", () => {
    expect(summariseArgs({ a: 1, b: 2, c: 3, d: 4 })).toBe("a: 1, b: 2, c: 3");
    expect(summariseArgs({ title: "x".repeat(60) })).toMatch(/…$/);
  });

  it("skips nested values and nulls rather than dumping JSON", () => {
    expect(summariseArgs({ event: { title: "x" }, id: null, arena: "family" })).toBe("arena: family");
  });

  it("handles input that is not an object at all", () => {
    expect(summariseArgs("hello")).toBe("");
    expect(summariseArgs(null)).toBe("");
  });
});
