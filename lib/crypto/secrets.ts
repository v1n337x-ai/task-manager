/**
 * Secret encryption at rest (Phase 2.1 brief §6).
 * AES-256-GCM envelope: ciphertext || [12B iv] || [16B auth tag], base64.
 * Key source: APP_ENCRYPTION_KEY — a DEDICATED secret, never AUTH_SECRET or
 * APPLICATION_KEY reuse (enforced in lib/env.ts). Server-only usage.
 */
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

function encryptionKeyBytes(): Buffer {
  const keyBase = getEnv().APP_ENCRYPTION_KEY;
  // Accept 32-byte hex or base64 keys; derive a stable 32-byte buffer otherwise.
  if (/^[0-9a-f]{64}$/i.test(keyBase)) return Buffer.from(keyBase, "hex");
  try {
    const b = Buffer.from(keyBase, "base64");
    if (b.length === 32) return b;
  } catch {
    // fall through to HKDF-style derive below
  }
  // Deterministic 32-byte derivation for arbitrary passphrases (documented).
  return createHash("sha256").update(keyBase).digest();
}

import { createHash } from "node:crypto";

/** Encrypt a secret for storage. Returns "v1:" + base64 envelope. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new AppError("VALIDATION_ERROR", 422, "Nothing to encrypt.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKeyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([ciphertext, iv, tag]).toString("base64")}`;
}

/** Decrypt a stored secret. Throws a sanitized error on any mismatch. */
export function decryptSecret(envelope: string): string {
  try {
    if (!envelope.startsWith("v1:")) throw new Error("unsupported envelope");
    const raw = Buffer.from(envelope.slice(3), "base64");
    const ciphertext = raw.subarray(0, raw.length - 28);
    const iv = raw.subarray(raw.length - 28, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKeyBytes(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("INTERNAL_ERROR", 500, "Stored secret could not be decrypted (wrong APP_ENCRYPTION_KEY or corrupted record).");
  }
}

/** Tamper-proof-ish consistency check (without exposing the value). */
export function isEncryptedEnvelope(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("v1:") && value.length > 40;
}
