/**
 * AI configuration service (Phase 2.1).
 * - Persists the provider API key ONLY as an AES-256-GCM envelope.
 * - GET responses expose a safe DTO (configured/provider/enabled/test state) —
 *   never plaintext, ciphertext, or last4 beyond the masked hint (§13).
 * - Save semantics (§10): empty apiKey on an existing config preserves the
 *   stored key; a new key replaces it; explicit clear requires confirmation
 *   (handled by the UI dialog + audited action).
 */
import { prisma } from "@/lib/db";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { decryptSecret, encryptSecret, isEncryptedEnvelope } from "@/lib/crypto/secrets";
import { isValidProvider, providerLabel, testProviderConnection, UnknownProviderError } from "@/lib/ai/provider-catalog";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export interface AiConfigSafeDTO {
  configured: boolean;
  provider: string; // slug
  providerLabel: string;
  enabled: boolean;
  apiKeyHint: string | null; // "•••• abcd" style, display only
  lastTestedAt: string | null;
  lastTestStatus: "NOT_TESTED" | "PASSED" | "FAILED" | "UNAVAILABLE";
  lastTestMessage: string | null;
}

const PROVIDER_SLUG = "opencode";

function toSafeDTO(row: {
  provider: string;
  encryptedApiKey: string | null;
  enabled: boolean;
  apiKeyLast4: string | null;
  lastTestedAt: Date | null;
  lastTestStatus: "NOT_TESTED" | "PASSED" | "FAILED" | "UNAVAILABLE";
  lastTestMessage: string | null;
}): AiConfigSafeDTO {
  return {
    configured: row.encryptedApiKey !== null && isEncryptedEnvelope(row.encryptedApiKey),
    provider: row.provider,
    providerLabel: providerLabel(row.provider),
    enabled: row.enabled,
    apiKeyHint: row.apiKeyLast4 ? `•••• ${row.apiKeyLast4}` : null,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
  };
}

async function getOrCreateRow(provider: string) {
  const existing = await prisma.aiConfiguration.findUnique({ where: { provider } });
  if (existing) return existing;
  if (!isValidProvider(provider)) throw new UnknownProviderError(provider);
  return prisma.aiConfiguration.create({ data: { provider } });
}

export async function getAiConfigSafe(provider = PROVIDER_SLUG): Promise<AiConfigSafeDTO> {
  const row = await prisma.aiConfiguration.findUnique({ where: { provider } });
  if (!row) {
    return {
      configured: false,
      provider,
      providerLabel: providerLabel(provider),
      enabled: true,
      apiKeyHint: null,
      lastTestedAt: null,
      lastTestStatus: "NOT_TESTED",
      lastTestMessage: null,
    };
  }
  return toSafeDTO(row);
}

export interface SaveAiConfigInput {
  provider: string;
  enabled?: boolean;
  apiKey?: string | null; // undefined → preserve; null/empty keeps preservation; string → replace
}

/** §9/§10: validate → encrypt → upsert; plaintext never persisted or logged. */
export async function saveAiConfig(input: SaveAiConfigInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }): Promise<AiConfigSafeDTO> {
  if (!isValidProvider(input.provider)) throw ValidationError("Unknown provider.");
  const row = await getOrCreateRow(input.provider);

  let nextEncrypted = row.encryptedApiKey;
  let nextLast4 = row.apiKeyLast4;
  let keyChanged = false;

  const provided = typeof input.apiKey === "string" ? input.apiKey.trim() : undefined;
  if (typeof provided === "string" && provided.length > 0) {
    if (provided.length < 8) throw ValidationError("API key looks too short (minimum 8 characters).");
    nextEncrypted = encryptSecret(provided);
    nextLast4 = provided.slice(-4);
    keyChanged = true;
  }

  const updated = await prisma.aiConfiguration.upsert({
    where: { provider: input.provider },
    create: {
      provider: input.provider,
      encryptedApiKey: nextEncrypted ?? undefined,
      apiKeyLast4: nextLast4 ?? undefined,
      enabled: input.enabled ?? true,
    },
    update: {
      ...(keyChanged ? { encryptedApiKey: nextEncrypted, apiKeyLast4: nextLast4 } : {}),
      enabled: input.enabled === undefined ? undefined : input.enabled,
    },
  });

  await recordAudit({
    action: keyChanged ? "ai_config.key_replaced" : "ai_config.saved",
    entityType: "AiConfiguration",
    entityId: updated.id,
    fieldName: keyChanged ? "encryptedApiKey" : "enabled",
    oldValue: undefined,
    newValue: keyChanged ? "[REDACTED]" : JSON.stringify({ enabled: updated.enabled }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    index: { provider: input.provider, keyChanged, note: "api key value never audited" },
  });

  logger.info("ai_config.saved", { provider: input.provider, keyChanged, enabled: updated.enabled, actorUserId });
  return toSafeDTO(updated);
}

/** §10: explicit removal — deletes the stored envelope (audit never logs the key). */
export async function clearAiApiKey(provider: string, actorUserId: number, ctx: { ip?: string; userAgent?: string }): Promise<AiConfigSafeDTO> {
  const row = await prisma.aiConfiguration.findUnique({ where: { provider } });
  if (!row) throw NotFoundError("AI configuration");
  const updated = await prisma.aiConfiguration.update({
    where: { provider },
    data: { encryptedApiKey: null, apiKeyLast4: null, lastTestStatus: "NOT_TESTED", lastTestMessage: null, lastTestedAt: null },
  });
  await recordAudit({
    action: "ai_config.key_cleared",
    entityType: "AiConfiguration",
    entityId: updated.id,
    fieldName: "encryptedApiKey",
    oldValue: "[REDACTED]",
    newValue: null,
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return toSafeDTO(updated);
}

/** §14: server-only decryption + provider test; honest result (never fake). */
export async function runConnectionTest(provider: string, actorUserId: number, ctx: { ip?: string; userAgent?: string }) {
  const row = await prisma.aiConfiguration.findUnique({ where: { provider } });
  if (!row) throw NotFoundError("AI configuration");
  if (!row.encryptedApiKey) throw new AppError("VALIDATION_ERROR", 422, "No API key is configured yet.");

  const apiKey = decryptSecret(row.encryptedApiKey); // throws sanitized error if undecryptable
  const result = await testProviderConnection(provider, apiKey);

  const updated = await prisma.aiConfiguration.update({
    where: { provider },
    data: { lastTestedAt: new Date(), lastTestStatus: result.status, lastTestMessage: result.message },
  });

  await recordAudit({
    action: "ai_config.test",
    entityType: "AiConfiguration",
    entityId: updated.id,
    fieldName: "lastTestStatus",
    oldValue: row.lastTestStatus,
    newValue: result.status,
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    index: { provider, note: "connection test result only" },
  });

  logger.info("ai_config.test", { provider, status: result.status, actorUserId });
  return { ...toSafeDTO(updated), test: result };
}
