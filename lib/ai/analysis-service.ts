/**
 * AI analysis service (Phase 5 §7-§12, §45-§53).
 * Deterministic context → provider port → Zod-validated structured output →
 * AIExtraction (versioned run) → AiEvidence rows. NEVER mutates VAPT state.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getEnv, isProduction } from "@/lib/env";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { AI_EXTRACTION_V1, PROMPT_VERSION, type AiExtractionV1 } from "@/lib/ai/schema";
import { buildAnalysisContext, type ContextBuildResult } from "@/lib/ai/context";
import { resolveProviderPort } from "@/lib/ai/provider-registry";
import { decryptSecret } from "@/lib/crypto/secrets";
import type { EvidenceSourceType } from "@prisma/client";
export interface ThreadAnalysisRun {
  extractionId: number;
  status: "needs_review" | "failed";
  provider: string;
  modelRaw: string | null;
  schemaVersion: string;
  promptVersion: string;
  inputContextHash: string;
  reduced: boolean;
  reductions: string[];
  warnings: string[];
  structured: AiExtractionV1 | null;
}

const ANALYZE_RATE_LIMIT = Number(process.env.AI_ANALYZE_RATE_LIMIT_MAX ?? 3);
const ANALYZE_RATE_WINDOW = Number(process.env.AI_ANALYZE_RATE_WINDOW_SECONDS ?? 120);

/** Load thread payload and build deterministic context (§9/§10). */
async function loadThreadContext(threadId: number): Promise<{
  thread: { id: number; applicationId: number | null; subject: string | null };
  built: ContextBuildResult;
  messagesDb: { id: number; index: number }[];
}> {
  const thread = await prisma.emailThread.findUnique({
    where: { id: threadId },
    include: {
      application: { select: { name: true, displayName: true, webUrl: true, aliases: true } },
      messages: { orderBy: [{ sentAt: "asc" }, { id: "asc" }], include: { fromContact: true } },
    },
  });
  if (!thread) throw NotFoundError("Email thread");

  const messagesDb = thread.messages.map((m, index) => ({ id: m.id, index }));

  const built = buildAnalysisContext({
    applicationName: thread.application?.displayName ?? null,
    applicationUrl: thread.application?.webUrl ?? null,
    applicationAliases: thread.application?.aliases.map((a) => a.alias) ?? [],
    iterations: [],
    existingFindings: [],
    existingTestCases: [],
    subject: thread.subject,
    messages: thread.messages.map((m) => ({
      from: m.fromContact?.emailAddress ?? "(unknown sender)",
      recipients: [],
      sentAt: m.sentAt,
      bodyText: m.bodyText ?? (m.bodyHtml ? "(html-only message)" : "(empty body)"),
      participants: [],
    })),
  });

  return {
    thread: { id: thread.id, applicationId: thread.applicationId, subject: thread.subject },
    built,
    messagesDb,
  };
}

/** §7 explicit user-triggered thread analysis. VAPT state is never mutated. */
export async function analyzeThread(params: {
  threadId: number;
  userId: number;
  ctx: { ip?: string; userAgent?: string };
  providerOverrideSlug?: string; // tests inject the deterministic mock
}): Promise<ThreadAnalysisRun> {
  const env = getEnv();
  void env;
  const limit = checkRateLimit(`ai_analyze:user:${params.userId}`, ANALYZE_RATE_LIMIT, ANALYZE_RATE_WINDOW);
  if (!limit.allowed) {
    throw new AppError("RATE_LIMITED", 429, `AI analysis rate limit reached. Retry in ${limit.retryAfterSeconds}s.`);
  }

  const { thread, built, messagesDb } = await loadThreadContext(params.threadId);

  const configured = await prisma.aiConfiguration.findUnique({ where: { provider: "opencode" } });
  const slug = params.providerOverrideSlug ?? (configured?.enabled ? "opencode" : null);
  if (!slug) {
    throw new AppError("VALIDATION_ERROR", 422, "No AI provider is enabled. Configure one under Settings → AI.");
  }
  let port;
  try {
    // Real ports receive their credential ONLY through this in-memory options
    // object — plaintext never touches the database, logs, or audit trail.
    const portOptions = slug === "opencode" && configured?.encryptedApiKey ? { credential: decryptSecret(configured.encryptedApiKey) } : {};
    port = resolveProviderPort(slug, isProduction(), portOptions);
  } catch {
    throw new AppError("VALIDATION_ERROR", 422, `Unknown AI provider "${slug}".`);
  }

  await recordAudit({
    action: "ai_analysis.started",
    entityType: "EmailThread",
    entityId: params.threadId,
    newValue: JSON.stringify({ provider: slug, contextHash: built.hash, messages: built.context.messages.length }),
    source: "HUMAN",
    actorUserId: params.userId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });

  const startedAt = Date.now();
  const pending = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "extraction_status", value: "pending" } } });
  if (!pending) throw NotFoundError("extraction_status/pending");

  const extraction = await prisma.aiExtraction.create({
    data: {
      threadId: params.threadId,
      applicationId: thread.applicationId,
      providerSlug: slug,
      modelRaw: port.modelRaw,
      schemaVersion: "AI_EXTRACTION_V1",
      promptVersion: PROMPT_VERSION,
      inputContextHash: built.hash,
      extractionType: "thread_vapt_analysis",
      status: pending.id,
    },
  });

  try {
    const providerResult = await port.analyze(built.context);
    const rawOutput = typeof providerResult.structured === "string" ? providerResult.structured : JSON.stringify(providerResult.structured);
    const parsedJson = JSON.parse(rawOutput) as unknown;
    // §51 — Zod validation of the structured response.
    const validated = AI_EXTRACTION_V1.parse(parsedJson);

    const needsReview = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "extraction_status", value: "needs_review" } } });
    if (!needsReview) throw NotFoundError("extraction_status/needs_review");

    const saved = await prisma.aiExtraction.update({
      where: { id: extraction.id },
      data: {
        status: needsReview.id,
        rawOutput: rawOutput.slice(0, 100_000),
        outputHash: createHash("sha256").update(rawOutput).digest("hex"),
        structuredOutput: validated as never,
        confidence: Math.round(
          (validated.participants.reduce((acc, p) => acc + (p.score ?? 0.5), 0) / Math.max(1, validated.participants.length)) * 100,
        ),
        durationMs: Date.now() - startedAt,
        modelRaw: providerResult.modelRaw,
      },
    });

    // §32/§33 — minimal evidence rows linked to REAL messages (§62 references validated).
    const type: EvidenceSourceType = "EMAIL_MESSAGE";
    const messageIndexToDbId = new Map(messagesDb.map((m) => [m.index, m.id]));
    const evidencePayload: never[] = [];
    void evidencePayload;
    const rows: { field: string; extractedValue: string; excerpt: string; confidence: string; messageIndex: number }[] = [];
    validated.participants.forEach((p, i) => {
      p.evidence.forEach((e) => rows.push({ field: `participant.role:[${i}]`, extractedValue: p.proposedRole, excerpt: e.excerpt, confidence: e.confidence, messageIndex: e.messageIndex }));
    });
    validated.findings.forEach((f, i) => {
      f.evidence.forEach((e) => rows.push({ field: `finding:[${i}].status`, extractedValue: f.statusSignal ?? f.severity, excerpt: e.excerpt, confidence: e.confidence, messageIndex: e.messageIndex }));
    });
    validated.iterationSignals.forEach((s, i) => {
      s.evidence.forEach((e) => rows.push({ field: `iterationSignal:[${i}]`, extractedValue: s.candidateIteration?.toString() ?? "unknown", excerpt: e.excerpt, confidence: e.confidence, messageIndex: e.messageIndex }));
    });
    for (const ev of rows.slice(0, 300)) {
      const dbMessageId = messageIndexToDbId.get(ev.messageIndex);
      if (!dbMessageId) continue; // invalid reference — rejected silently but audit-visible via weaknesses
      await prisma.aiEvidence.create({
        data: {
          extractionId: saved.id,
          sourceType: type,
          sourceId: dbMessageId,
          field: ev.field,
          extractedValue: ev.extractedValue,
          excerpt: ev.excerpt.slice(0, 900),
          confidence: ev.confidence === "HIGH" ? 90 : ev.confidence === "MEDIUM" ? 65 : 35,
        },
      });
    }

    await recordAudit({
      action: "ai_analysis.completed",
      entityType: "AiExtraction",
      entityId: saved.id,
      newValue: JSON.stringify({ threadId: params.threadId, findings: validated.findings.length, participants: validated.participants.length }),
      source: "SYSTEM",
      actorUserId: params.userId,
    });
    logger.info("ai_analysis.completed", { extractionId: saved.id, threadId: params.threadId, provider: slug, actorUserId: params.userId });

    return {
      extractionId: saved.id,
      status: "needs_review",
      provider: slug,
      modelRaw: providerResult.modelRaw,
      schemaVersion: "AI_EXTRACTION_V1",
      promptVersion: PROMPT_VERSION,
      inputContextHash: built.hash,
      reduced: built.reduced,
      reductions: built.reductions,
      warnings: providerResult.warnings,
      structured: validated,
    };
  } catch (error) {
    const failed = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "extraction_status", value: "failed" } } });
    const sanitized = sanitizeFailure(error);
    await prisma.aiExtraction.update({
      where: { id: extraction.id },
      data: {
        status: failed?.id ?? pending.id,
        errorMessage: sanitized,
        durationMs: Date.now() - startedAt,
      },
    });
    await recordAudit({
      action: "ai_analysis.failed",
      entityType: "AiExtraction",
      entityId: extraction.id,
      newValue: JSON.stringify({ threadId: params.threadId, error: sanitized }),
      source: "SYSTEM",
      actorUserId: params.userId,
    });
    logger.error("ai_analysis.failed", { extractionId: extraction.id, error: sanitized });
    throw new AppError("VALIDATION_ERROR", 422, sanitized);
  }
}

function sanitizeFailure(error: unknown): string {
  const text = String(error);
  // §50/§55 — provider failures surface safely; no keys, no bodies.
  // Provider-configuration gaps (server/credential not supplied or server
  // unreachable) map to the honest contract-unavailable message.
  if (/not implemented|contract|not usable right now|configuration is supplied|configuration error/i.test(text)) {
    return "AI provider contract unavailable — analysis cannot run until the provider configuration is supplied. No data was altered.";
  }
  if (/malformed|invalid JSON|schema/i.test(text)) return "AI response failed validation against AI_EXTRACTION_V1.";
  if (/timeout|rate/i.test(text)) return "AI provider timed out or rate-limited the request.";
  if (/auth|key/i.test(text)) return "AI provider authentication failed.";
  return `AI analysis failed: ${text.slice(0, 180)}`;
}
