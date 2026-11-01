/**
 * Authoritative state service (Phase 6 §3-§5, §22-§26, §45-§47).
 * Deterministic calculation of the CURRENT state per finding from the
 * append-only ledger: decisions + status history + iteration states.
 * NEVER deletes history — the projection (current surface status) is
 * re-derivable at any time via recalculate.
 */
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

// §12 state machine
export const FINDING_STATES = [
  "open",
  "fixed",
  "not_fixed",
  "reopened",
  "retested",
  "not_retested",
  "removed",
  "out_of_scope",
  "accepted_risk",
] as const;

export type DecisionSource = "STRUCTURED_DATA" | "COMMUNICATION" | "AI_APPROVED" | "HUMAN_CORRECTION" | "SYSTEM_CALCULATION";

export interface DecisionInput {
  entityType: "finding" | "test_case" | "iteration";
  entityId: number;
  iterationId?: number | null;
  iterationNumber?: number | null;
  previousState?: string | null;
  newState: string;
  verification?: "DEVELOPER_REPORTED" | "RETEST_VERIFIED" | "NONE" | null;
  resolutionMethod: "EXPLICIT_COMMUNICATION" | "INFERRED_CONTEXT" | "HUMAN_CORRECTION" | "AI_APPROVED" | "SYSTEM_DEFAULT";
  decisionSource: DecisionSource;
  sourceMessageId?: number | null;
  sourceThreadId?: number | null;
  aiExtractionId?: number | null;
  evidenceRef?: Array<{ excerpt: string; messageIndex?: number }> | null;
  approvedByUserId?: number | null;
  reason?: string | null;
}

/** §25 — one decision, transactional append. Idempotent by natural key. */
export async function recordAuthoritativeDecision(input: DecisionInput): Promise<{ id: number; created: boolean }> {
  await validateStateGuardrails(input);

  const existing = await prisma.authoritativeStateDecision.findFirst({
    where: {
      entityType: input.entityType,
      entityId: input.entityId,
      iterationId: input.iterationId ?? null,
      newState: input.newState,
      sourceMessageId: input.sourceMessageId ?? null,
    },
  });
  if (existing) return { id: existing.id, created: false }; // §46 idempotency

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.authoritativeStateDecision.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        iterationId: input.iterationId ?? null,
        iterationNumber: input.iterationNumber ?? null,
        previousState: input.previousState ?? null,
        newState: input.newState,
        verification: input.verification ?? null,
        resolutionMethod: input.resolutionMethod,
        decisionSource: input.decisionSource,
        sourceMessageId: input.sourceMessageId ?? null,
        sourceThreadId: input.sourceThreadId ?? null,
        aiExtractionId: input.aiExtractionId ?? null,
        evidenceRef: (input.evidenceRef ?? undefined) as never,
        approvedByUserId: input.approvedByUserId ?? null,
        approvedAt: new Date(),
        reason: input.reason ?? null,
      },
    });

    // Finding projection + history append for approved decisions (§23: history first).
    if (input.entityType === "finding") {
      const finding = await tx.finding.findUnique({ where: { id: input.entityId }, include: { statusRef: true } });
      if (!finding) throw NotFoundError("Finding");
      const statusId = (await tx.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "finding_status", value: input.newState } } })).id;

      if (input.iterationId) {
        // per-iteration state row (append; never overwrite other iterations)
        await tx.findingIterationState.upsert({
          where: { findingId_iterationId: { findingId: input.entityId, iterationId: input.iterationId } },
          update: { status: statusId, severity: finding.severity },
          create: {
            findingId: input.entityId,
            iterationId: input.iterationId,
            severity: finding.severity,
            status: statusId,
          },
        });
      }

      // Surface projection (latest authoritative decision wins chronologically — §13/§14)
      await tx.findingStatusHistory.create({
        data: {
          findingId: input.entityId,
          iterationId: input.iterationId ?? null,
          oldStatusCode: finding.statusRef.value,
          newStatusCode: input.newState,
          note: input.reason ?? null,
          actorUserId: input.approvedByUserId ?? null,
          source: input.decisionSource === "AI_APPROVED" ? "AI" : input.decisionSource === "COMMUNICATION" ? "EML" : "HUMAN",
        },
      });
      await tx.finding.update({ where: { id: input.entityId }, data: { currentStatus: statusId } });
    }

    if (input.entityType === "test_case" && input.iterationId) {
      const statusId = (await tx.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "test_case_status", value: input.newState } } })).id;
      const tc = await tx.testCase.findUnique({ where: { id: input.entityId } });
      if (!tc) throw NotFoundError("Test case");
      await tx.testCaseIteration.upsert({
        where: { testCaseId_iterationId: { testCaseId: input.entityId, iterationId: input.iterationId } },
        update: { status: statusId, notes: input.reason ?? undefined },
        create: { testCaseId: input.entityId, iterationId: input.iterationId, status: statusId, notes: input.reason ?? null },
      });
      if (["removed", "out_of_scope"].includes(input.newState)) {
        await tx.testCase.update({ where: { id: input.entityId }, data: { isActive: false } });
      }
    }

    return row;
  });

  await recordAudit({
    action: "state_decision.recorded",
    entityType: input.entityType,
    entityId: input.entityId,
    fieldName: "authoritativeState",
    oldValue: input.previousState ?? null,
    newValue: input.newState,
    source: input.decisionSource === "AI_APPROVED" ? "AI" : input.approvedByUserId ? "HUMAN" : "SYSTEM",
    actorUserId: input.approvedByUserId ?? null,
    ip: undefined,
    userAgent: undefined,
    index: { iterationNumber: input.iterationNumber, verification: input.verification, resolutionMethod: input.resolutionMethod },
  });
  logger.info("authoritative_state.decision", { id: created.id, entity: `${input.entityType}:${input.entityId}`, newState: input.newState });

  return { id: created.id, created: true };
}

async function validateStateGuardrails(_input: DecisionInput): Promise<void> {
  // State guardrails are enforced by Zod at the route boundary; the service
  // additionally validates AI-derived decisions always carry a human approver.
  if (_input.decisionSource === "AI_APPROVED" && !_input.approvedByUserId) {
    throw ValidationError("AI_APPROVED decisions require an approving user.");
  }
}

export interface AuthoritativeStateExplanation {
  findingId: number;
  code: string;
  title: string;
  severity: string;
  currentStatus: string;
  currentIterationNumber: number | null;
  firstSeenIterationNumber: number | null;
  lastUpdatedAt: string | null;
  verification: string | null;
  resolutionMethod: string | null;
  decisions: {
    id: number;
    iterationNumber: number | null;
    previousState: string | null;
    newState: string;
    verification: string | null;
    decisionSource: string;
    resolutionMethod: string;
    sourceMessageId: number | null;
    approvedAt: string | null;
    reason: string | null;
  }[];
  statusHistory: {
    at: string;
    oldStatus: string | null;
    newStatus: string;
    iterationNumber: number | null;
    source: string;
  }[];
}

/** §22/§45 — deterministic explanation + safe recalculation (§61: never fabricate). */
export async function calculateAuthoritativeFindingState(findingId: number): Promise<AuthoritativeStateExplanation> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    include: { severityRef: true, statusRef: true, history: { orderBy: { createdAt: "asc" }, include: { iteration: { select: { number: true } } } } },
  });
  if (!finding) throw NotFoundError("Finding");

  const decisions = await prisma.authoritativeStateDecision.findMany({
    where: { entityType: "finding", entityId: findingId },
    orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
  });

  // §14 chronological precedence: approved human corrections ~approvedAt wins;
  // when no approvedAt (structured data), ranked by decision source weight.
  const weight = (d: (typeof decisions)[number]): number => {
    if (d.approvedAt && new Date(d.approvedAt).getTime() > 0) return new Date(d.approvedAt).getTime();
    switch (d.decisionSource) {
      case "HUMAN_CORRECTION": return 9e14;
      case "AI_APPROVED": return 8e14;
      case "STRUCTURED_DATA": return 7e14;
      case "COMMUNICATION": return 6e14;
      default: return 5e14;
    }
  };
  const authoritative = decisions.length ? [...decisions].sort((a, b) => weight(a) - weight(b)).at(-1)! : null;

  return {
    findingId: finding.id,
    code: finding.code,
    title: finding.title,
    severity: finding.severityRef.value,
    currentStatus: finding.statusRef.value,
    currentIterationNumber: authoritative?.iterationNumber ?? null,
    firstSeenIterationNumber: finding.firstSeenIterationNumber,
    lastUpdatedAt: finding.updatedAt.toISOString(),
    verification: authoritative?.verification ?? null,
    resolutionMethod: authoritative?.resolutionMethod ?? null,
    decisions: decisions.map((d) => ({
      id: d.id,
      iterationNumber: d.iterationNumber,
      previousState: d.previousState,
      newState: d.newState,
      verification: d.verification,
      decisionSource: d.decisionSource,
      resolutionMethod: d.resolutionMethod,
      sourceMessageId: d.sourceMessageId,
      approvedAt: d.approvedAt?.toISOString() ?? null,
      reason: d.reason,
    })),
    statusHistory: finding.history.map((h) => ({
      at: h.createdAt.toISOString(),
      oldStatus: h.oldStatusCode,
      newStatus: h.newStatusCode,
      iterationNumber: h.iteration?.number ?? null,
      source: h.source,
    })),
  };
}

/** §23/§45 — re-projection from history; never invents a state (§61). */
export async function recalculateFindingProjection(findingId: number): Promise<{ projection: string; rebuiltFrom: number }> {
  const decisions = await prisma.authoritativeStateDecision.findMany({
    where: { entityType: "finding", entityId: findingId },
    orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
  });
  if (decisions.length === 0) return { projection: "open", rebuiltFrom: 0 };
  const latest = decisions[decisions.length - 1]!;
  const statusId = (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "finding_status", value: latest.newState } } })).id;
  await prisma.finding.update({ where: { id: findingId }, data: { currentStatus: statusId } });
  return { projection: latest.newState, rebuiltFrom: decisions.length };
}

void (undefined as unknown as Prisma.TransactionClient);
