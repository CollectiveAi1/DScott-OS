import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEncryptionKey } from "./encryption-key";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM for values at rest in settings.encrypted_keys (OAuth tokens, provider keys).
 * Format: v1:<iv>:<tag>:<ciphertext>, each part base64url. The version prefix is there so a key
 * rotation or an algorithm change can be told apart from values written before it.
 */
export function encrypt(plaintext: string, key = getEncryptionKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url"));
  return [VERSION, ...parts].join(":");
}

/** Throws when the value is malformed, was tampered with, or was written with another key. */
export function decrypt(value: string, key = getEncryptionKey()): string {
  const parts = value.split(":");
  if (parts.length !== 4) throw new Error("Encrypted value is malformed.");
  const [version, ivPart, tagPart, bodyPart] = parts as [string, string, string, string];
  if (version !== VERSION) throw new Error(`Unsupported encrypted value version: ${version}.`);

  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("Encrypted value is malformed.");

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(bodyPart, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // The underlying error carries no useful detail for Devon and could echo key material.
    throw new Error("Encrypted value could not be decrypted.");
  }
}
