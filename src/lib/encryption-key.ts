import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const KEY_BYTES = 32;

let cached: Buffer | undefined;

function decode(value: string, source: string): Buffer {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`${source} must decode to ${KEY_BYTES} bytes (generate with: openssl rand -base64 32).`);
  }
  return key;
}

/**
 * ENCRYPTION_KEY protects the OAuth tokens in settings.encrypted_keys. Production must set it.
 * In local development a random key is generated once into .data/ (git-ignored), the same way
 * AUTH_SECRET is, so nothing secret ever lives in source.
 */
export function getEncryptionKey(): Buffer {
  if (cached) return cached;
  const fromEnv = process.env.ENCRYPTION_KEY;
  if (fromEnv) return (cached = decode(fromEnv, "ENCRYPTION_KEY"));
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_EMBEDDED_DB !== "1") {
    throw new Error("ENCRYPTION_KEY is required in production.");
  }
  const file = ".data/dev-encryption-key";
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(KEY_BYTES).toString("base64"), { mode: 0o600 });
  }
  return (cached = decode(readFileSync(file, "utf8"), "the development encryption key"));
}
