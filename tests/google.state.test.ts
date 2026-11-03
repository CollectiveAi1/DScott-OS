import { describe, expect, it } from "vitest";
import { createState, STATE_MINUTES, verifyState } from "../src/modules/google/state";

const secret = "a-test-secret-long-enough-for-hmac-0123456789";
const other = "a-different-secret-entirely-0123456789abcdef";

describe("OAuth state", () => {
  it("accepts a state that matches its cookie", () => {
    const state = createState(secret);
    expect(verifyState(state, state, secret)).toBe(true);
  });

  it("is different every time", () => {
    expect(createState(secret)).not.toBe(createState(secret));
  });

  it("refuses a state that does not match the cookie", () => {
    expect(verifyState(createState(secret), createState(secret), secret)).toBe(false);
  });

  it("refuses a missing state or a missing cookie", () => {
    const state = createState(secret);
    expect(verifyState(undefined, state, secret)).toBe(false);
    expect(verifyState(state, undefined, secret)).toBe(false);
    expect(verifyState(undefined, undefined, secret)).toBe(false);
    expect(verifyState("", "", secret)).toBe(false);
  });

  it("refuses a tampered body even when the cookie was tampered the same way", () => {
    const state = createState(secret);
    const [, mac] = state.split(".");
    const forged = `${Buffer.from(JSON.stringify({ n: "x", exp: Date.now() + 1e9 })).toString("base64url")}.${mac}`;
    expect(verifyState(forged, forged, secret)).toBe(false);
  });

  it("refuses a state signed with another secret", () => {
    const state = createState(other);
    expect(verifyState(state, state, secret)).toBe(false);
  });

  it("refuses an expired state", () => {
    const now = Date.now();
    const state = createState(secret, now);
    expect(verifyState(state, state, secret, now + (STATE_MINUTES - 1) * 60_000)).toBe(true);
    expect(verifyState(state, state, secret, now + (STATE_MINUTES + 1) * 60_000)).toBe(false);
  });

  it("refuses malformed input without throwing", () => {
    for (const bad of ["notoken", "a.b.c", "....", "%%%.%%%"]) {
      expect(verifyState(bad, bad, secret)).toBe(false);
    }
  });
});
