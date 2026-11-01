import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { checkSignInAllowed, recordFailedSignIn } from "../src/lib/auth/rate-limit";
import { createToken, readToken } from "../src/lib/auth/token";

const secret = "test-secret-that-is-long-enough-for-hmac-1234";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("my cup is always full");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("my cup is always full", stored)).toBe(true);
    expect(await verifyPassword("my cup is always fulL", stored)).toBe(false);
  });

  it("rejects a malformed stored hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips claims", () => {
    const token = createToken(3, secret, 1_000);
    expect(readToken(token, secret, 2_000)?.v).toBe(3);
  });

  it("rejects a tampered body", () => {
    const [, mac] = createToken(1, secret).split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, exp: Date.now() + 1e12 })).toString("base64url");
    expect(readToken(`${forged}.${mac}`, secret)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    expect(readToken(createToken(1, "another-secret-entirely-xxxxxxxxxxxxx"), secret)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = createToken(1, secret, 0);
    expect(readToken(token, secret, 31 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});

describe("sign-in rate limit", () => {
  it("blocks after five failures in the window", () => {
    const key = `ip-${Math.random()}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(checkSignInAllowed(key, 1_000).allowed).toBe(true);
      recordFailedSignIn(key, 1_000);
    }
    expect(checkSignInAllowed(key, 1_000).allowed).toBe(false);
    expect(checkSignInAllowed(key, 1_000 + 16 * 60 * 1000).allowed).toBe(true);
  });
});
