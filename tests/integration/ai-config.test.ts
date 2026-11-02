/**
 * Phase 2.1 — AI API key configuration tests (brief sections 5-16).
 * Unit: secret encryption roundtrip + tamper detection + envelope validation.
 * Integration (test DB): service secrecy contract — GET DTO never contains the
 * key; save/replace/preserve; clear; honest (UNAVAILABLE) connection test;
 * audit without the key value.
 */
import { describe, it, expect } from "vitest";
import { describe as dbDescribe, it as dbIt, beforeAll as dbBeforeAll } from "vitest";
import { encryptSecret, decryptSecret, isEncryptedEnvelope } from "@/lib/crypto/secrets";
import { dbAvailable, resetTestData, seedMinimal, testDb } from "../setup-db";
import bcrypt from "bcryptjs";

function encryptionKeyFromEnv(): string {
  return process.env.APP_ENCRYPTION_KEY ?? "dev_encrypt_key_7c1f9d3a4b8e2f60c5d9a8b3e7f1c4d9a6b2e8f3c5d7a9b1e4f6c8d2a5b7e9c1";
}

// lib/env validates APP_ENCRYPTION_KEY; set a test-grade 64-char value before import.
process.env.APP_ENCRYPTION_KEY = encryptionKeyFromEnv().padEnd(64, "0").slice(0, 64);

describe("secret encryption (AES-256-GCM envelope)", () => {
  it("roundtrips arbitrary API keys", () => {
    const key = "sk-or-v1-abc123ZXCVBNM!";
    const envelope = encryptSecret(key);
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(envelope).not.toContain(key);
    expect(decryptSecret(envelope)).toBe(key);
  });

  it("produces unique ciphertexts per call (fresh IV)", () => {
    expect(encryptSecret("same-key")).not.toBe(encryptSecret("same-key"));
  });

  it("never echoes plaintext in the envelope", () => {
    const secret = "super-secret-key-42";
    const envelope = encryptSecret(secret);
    expect(Buffer.from(envelope, "utf8").includes(secret)).toBe(false);
  });

  it("detects tampering (auth tag mismatch)", () => {
    const envelope = encryptSecret("kes-1-abcdef");
    // Flip the first ciphertext character after the "v1:" prefix (base64
    // padding chars at the very end can decode identically in Node's lenient
    // base64 parser — a real attacker would alter payload bytes).
    const head = envelope.slice(0, 3);
    const firstChar = envelope[3]!;
    const tampered = head + (firstChar === "A" ? "B" : "A") + envelope.slice(4);
    expect(() => decryptSecret(tampered)).toThrow(/could not be decrypted/);
  });

  it("rejects garbage envelopes", () => {
    expect(() => decryptSecret("not-an-envelope")).toThrow();
    expect(isEncryptedEnvelope("not-an-envelope")).toBe(false);
    expect(isEncryptedEnvelope(encryptSecret("some-x-key"))).toBe(true);
  });
});

dbDescribe.skipIf(!dbAvailable)("AI configuration service (test DB)", () => {
  let userId = 0;
  dbBeforeAll(async () => {
    await resetTestData();
    ({ userId } = await seedMinimal(bcrypt));
  }, 60_000);

  dbIt("GET DTO never exposes plaintext, ciphertext or the last-4 secret (§13)", async () => {
    const svc = await import("@/lib/services/ai-config-service");
    await svc.saveAiConfig({ provider: "opencode", apiKey: "sk-test-9876543210" }, userId, {});
    const safe = await svc.getAiConfigSafe();
    const json = JSON.stringify(safe);
    expect(safe.configured).toBe(true);
    expect(safe.provider).toBe("opencode");
    expect(json).not.toContain("sk-test-9876543210");          // plaintext absent
    expect(json).not.toContain("v1:");                          // ciphertext absent
    expect(safe.apiKeyHint).toBe("•••• 3210");                  // masked display hint only
  });

  dbIt("SAVE with empty apiKey preserves the stored envelope; new key replaces (§10)", async () => {
    const svc = await import("@/lib/services/ai-config-service");
    await svc.saveAiConfig({ provider: "opencode", apiKey: "first-key-111222333" }, userId, {});
    const before = await testDb.aiConfiguration.findUniqueOrThrow({ where: { provider: "opencode" } });
    await svc.saveAiConfig({ provider: "opencode", enabled: false }, userId, {}); // no new key
    const after = await testDb.aiConfiguration.findUniqueOrThrow({ where: { provider: "opencode" } });
    expect(after.encryptedApiKey).toBe(before.encryptedApiKey);
    expect(after.enabled).toBe(false);

    await svc.saveAiConfig({ provider: "opencode", apiKey: "second-key-555000999" }, userId, {});
    const replaced = await testDb.aiConfiguration.findUniqueOrThrow({ where: { provider: "opencode" } });
    expect(replaced.encryptedApiKey).not.toBe(before.encryptedApiKey);
  });

  dbIt("decrypted value stays server-only and decrypts correctly", async () => {
    const svc = await import("@/lib/services/ai-config-service");
    await svc.saveAiConfig({ provider: "opencode", apiKey: "decrypt-probe-777" }, userId, {});
    const row = await testDb.aiConfiguration.findUniqueOrThrow({ where: { provider: "opencode" } });
    const { decryptSecret } = await import("@/lib/crypto/secrets");
    expect(decryptSecret(row.encryptedApiKey!)).toBe("decrypt-probe-777");
  });

  dbIt("CLEAR_KEY wipes the envelope (with audit, no key value logged, §10/§35)", async () => {
    const svc = await import("@/lib/services/ai-config-service");
    await svc.saveAiConfig({ provider: "opencode", apiKey: "clear-probe-5150" }, userId, {});
    const safe = await svc.clearAiApiKey("opencode", userId, {});
    expect(safe.configured).toBe(false);
    const row = await testDb.aiConfiguration.findUniqueOrThrow({ where: { provider: "opencode" } });
    expect(row.encryptedApiKey).toBeNull();
  });

  dbIt("connection test is honest without server config (UNAVAILABLE, §15; with config it performs a real /api/info check)", async () => {
    const svc = await import("@/lib/services/ai-config-service");
    await svc.saveAiConfig({ provider: "opencode", apiKey: "honest-probe-0000" }, userId, {});
    const result = await svc.runConnectionTest("opencode", userId, {});
    expect(result.test.status).toBe("UNAVAILABLE");
    expect(result.test.message).toMatch(/until the OpenCode provider endpoint\/configuration is supplied/i);
    // never "Connected":
    expect(result.test.status).not.toBe("PASSED");
  });

  dbIt("audit trail contains configuration actions but no key material (§35)", async () => {
    const logs = await testDb.auditLog.findMany();
    const joined = logs.map((l) => `${l.action} ${l.newValue ?? ""} ${l.oldValue ?? ""}`).join(" ");
    for (const probe of ["sk-test-9876543210", "first-key-111222333", "second-key-555000999", "clear-probe-5150", "honest-probe-0000", "decrypt-probe-777"]) {
      expect(joined).not.toContain(probe);
    }
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("ai_config.key_replaced");
    expect(actions).toContain("ai_config.key_cleared");
    expect(actions).toContain("ai_config.test");
  });
});
