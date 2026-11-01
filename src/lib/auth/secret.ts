import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

let cached: string | undefined;

/**
 * AUTH_SECRET signs session cookies. Production must set it. In local development a random
 * secret is generated once into .data/ (git-ignored) so nothing secret ever lives in source.
 */
export function getAuthSecret(): string {
  if (cached) return cached;
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 32) return (cached = fromEnv);
  if (fromEnv) throw new Error("AUTH_SECRET must be at least 32 characters.");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_EMBEDDED_DB !== "1") {
    throw new Error("AUTH_SECRET is required in production.");
  }
  const file = ".data/dev-auth-secret";
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return (cached = readFileSync(file, "utf8").trim());
}
