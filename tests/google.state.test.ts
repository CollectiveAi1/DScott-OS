import { afterEach, describe, expect, it } from "vitest";
import { hasPlaceholderCredentials, isConfigured } from "../src/modules/google/api";
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

/**
 * Placeholder credentials are the quiet failure: the variables exist, so `isConfigured()` says
 * yes and the panel claims Google is set up — then consent dies on Google's side with a message
 * that explains nothing. The shape of a client id is what separates the two.
 */
describe("hasPlaceholderCredentials", () => {
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

  afterEach(() => {
    if (saved.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = saved.id;
    if (saved.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = saved.secret;
  });

  function set(id: string | undefined, secret: string | undefined) {
    if (id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = id;
    if (secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = secret;
  }

  it("accepts a client id of the shape Google actually issues", () => {
    set("123456789012-abcdefghijklmnop.apps.googleusercontent.com", "GOCSPX-a-real-looking-secret");
    expect(isConfigured()).toBe(true);
    expect(hasPlaceholderCredentials()).toBe(false);
  });

  it("catches a stand-in that would otherwise look configured", () => {
    set("local-placeholder-client-id", "local-placeholder-secret");
    expect(isConfigured()).toBe(true);
    expect(hasPlaceholderCredentials()).toBe(true);
  });

  it("catches a stand-in that copied the domain but not the project number", () => {
    // This is the one that was actually sitting in .env.local: the memorable half is right.
    set("local-placeholder.apps.googleusercontent.com", "local-placeholder-secret");
    expect(isConfigured()).toBe(true);
    expect(hasPlaceholderCredentials()).toBe(true);
  });

  it("ignores surrounding whitespace, which is how these get pasted", () => {
    set("  123456789012-abc.apps.googleusercontent.com  ", "  secret  ");
    expect(hasPlaceholderCredentials()).toBe(false);
  });

  it("rejects the right domain on the wrong host", () => {
    set("123456789012-abc.apps.googleusercontent.com.evil.test", "secret");
    expect(hasPlaceholderCredentials()).toBe(true);
  });

  it("says nothing when the variables are simply absent — that is a different message", () => {
    set(undefined, undefined);
    expect(isConfigured()).toBe(false);
    expect(hasPlaceholderCredentials()).toBe(false);
  });

  it("says nothing when only one of the pair is set", () => {
    set("123456789012-abc.apps.googleusercontent.com", undefined);
    expect(hasPlaceholderCredentials()).toBe(false);
  });
});
