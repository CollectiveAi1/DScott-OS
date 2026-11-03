import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/lib/crypto";

const key = randomBytes(32);
const other = randomBytes(32);

function parts(value: string) {
  return value.split(":") as [string, string, string, string];
}

describe("crypto", () => {
  it("round-trips ASCII, Unicode and the empty string", () => {
    for (const secret of ["ya29.a0AfB_token", "clé—私—🔐", ""]) {
      expect(decrypt(encrypt(secret, key), key)).toBe(secret);
    }
  });

  it("writes the documented format and a fresh IV every time", () => {
    const first = encrypt("same input", key);
    const second = encrypt("same input", key);
    expect(parts(first)[0]).toBe("v1");
    expect(first).not.toBe(second);
    expect(Buffer.from(parts(first)[1], "base64url")).toHaveLength(12);
    expect(Buffer.from(parts(first)[2], "base64url")).toHaveLength(16);
  });

  it("rejects a flipped ciphertext byte", () => {
    const [version, iv, tag, body] = parts(encrypt("ya29.a0AfB_token", key));
    const bytes = Buffer.from(body, "base64url");
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0x01, 0);
    expect(() => decrypt([version, iv, tag, bytes.toString("base64url")].join(":"), key)).toThrow();
  });

  it("rejects a swapped tag and a swapped IV", () => {
    const a = parts(encrypt("token a", key));
    const b = parts(encrypt("token b", key));
    expect(() => decrypt(["v1", a[1], b[2], a[3]].join(":"), key)).toThrow();
    expect(() => decrypt(["v1", b[1], a[2], a[3]].join(":"), key)).toThrow();
  });

  it("rejects malformed values", () => {
    const value = encrypt("token", key);
    const [, iv, tag, body] = parts(value);
    expect(() => decrypt("", key)).toThrow(/malformed/);
    expect(() => decrypt(["v1", iv, tag].join(":"), key)).toThrow(/malformed/);
    expect(() => decrypt(["v1", iv, tag.slice(0, 8), body].join(":"), key)).toThrow(/malformed/);
    expect(() => decrypt(["v2", iv, tag, body].join(":"), key)).toThrow(/version/);
  });

  it("rejects a value written with another key", () => {
    expect(() => decrypt(encrypt("token", other), key)).toThrow();
  });

  it("never echoes key or ciphertext material in the error", () => {
    const secret = "ya29.a0AfB_token";
    try {
      decrypt(encrypt(secret, other), key);
      expect.unreachable("decrypt should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(secret);
      expect(message).not.toContain(key.toString("base64"));
    }
  });
});
