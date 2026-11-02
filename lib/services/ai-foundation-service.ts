/**
 * AI extraction foundations (brief sections 32-34, 61).
 * Phase 2 stores extraction records + evidence + human approvals. NO agent is
 * wired; no AI value may ever modify business rows directly — proposals become
 * approved decisions executed by human-controlled services.
 */
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

export interface CreateExtractionInput {
  sourceMessageId?: number | null;
  sourceAttachmentId?: number | null;
  applicationId?: number | null;
  extractionType: string;
  rawOutput?: string | null;
  structuredOutput?: unknown;
  confidence?: number | null;
  statusValue?: "pending" | "processed" | "needs_review" | "approved" | "rejected" | "failed";
}

export async function createExtraction(input: CreateExtractionInput, actorUserId: number | null, source = "SYSTEM") {
  const statusRow = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "extraction_status", value: input.statusValue ?? "pending" } },
  });
  if (!statusRow) throw ValidationError("Unknown extraction status.");

  if (input.confidence !== null && input.confidence !== undefined && (input.confidence < 0 || input.confidence > 100)) {
    throw ValidationError("Confidence must be 0..100.");
  }

  if (input.sourceMessageId) {
    const msg = await prisma.emailMessage.findUnique({ where: { id: input.sourceMessageId } });
    if (!msg) throw NotFoundError("Source email message");
  }
  if (input.sourceAttachmentId) {
    const att = await prisma.emailAttachment.findUnique({ where: { id: input.sourceAttachmentId } });
    if (!att) throw NotFoundError("Source attachment");
  }

  const row = await prisma.aiExtraction.create({
    data: {
      sourceMessageId: input.sourceMessageId ?? null,
      sourceAttachmentId: input.sourceAttachmentId ?? null,
      applicationId: input.applicationId ?? null,
      extractionType: input.extractionType,
      rawOutput: input.rawOutput ?? null,
      structuredOutput: (input.structuredOutput ?? undefined) as never,
      confidence: input.confidence ?? null,
      status: statusRow.id,
    },
  });

  await recordAudit({
    action: "ai_extraction.create",
    entityType: "AiExtraction",
    entityId: row.id,
    newValue: JSON.stringify({ type: input.extractionType, status: input.statusValue ?? "pending" }),
    source: source === "AI" ? "AI" : "SYSTEM",
    actorUserId,
  });

  return row;
}

export interface AddEvidenceInput {
  extractionId: number;
  sourceType: "EMAIL_MESSAGE" | "EMAIL_ATTACHMENT" | "APPLICATION" | "ITERATION" | "FINDING" | "TEST_CASE";
  sourceId: number;
  field: string;
  extractedValue: string;
  excerpt?: string | null;
  confidence?: number | null;
}

export async function addEvidence(input: AddEvidenceInput, actorUserId: number | null) {
  const extraction = await prisma.aiExtraction.findUnique({ where: { id: input.extractionId } });
  if (!extraction) throw NotFoundError("AI extraction");

  if (input.sourceType === "EMAIL_ATTACHMENT") {
    const att = await prisma.emailAttachment.findUnique({ where: { id: input.sourceId } });
    if (!att) throw NotFoundError("Source attachment");
  }

  const row = await prisma.aiEvidence.create({
    data: {
      extractionId: extraction.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      attachmentId: input.sourceType === "EMAIL_ATTACHMENT" ? input.sourceId : null,
      field: input.field,
      extractedValue: input.extractedValue,
      excerpt: input.excerpt ?? null,
      confidence: input.confidence ?? null,
    },
  });
  await recordAudit({
    action: "ai_evidence.create",
    entityType: "AiEvidence",
    entityId: row.id,
    newValue: JSON.stringify({ extractionId: input.extractionId, field: input.field, value: input.extractedValue }),
    source: "AI",
    actorUserId,
  });
  return row;
}

/**
 * Human decision on an AI proposal (§39): approve | reject | correct.
 * Applying an approved proposal is a separate, auditable service action —
 * the AI pipeline itself can never flip business rows. Item-level decisions
 * (§74) flow through the same table with itemKey + correctedValue.
 */
export async function recordApprovalDecision(
  input: {
    extractionId: number;
    decision: "approve" | "reject" | "correct" | "partially_approved";
    note?: string | null;
    itemKey?: string | null; // Phase 5 §74: null/undefined = whole-run decision
    correctedValue?: unknown; // CORRECT payload
  },
  actorUserId: number,
  ctx: { ip?: string; userAgent?: string },
) {
  const extraction = await prisma.aiExtraction.findUnique({ where: { id: input.extractionId } });
  if (!extraction) throw NotFoundError("AI extraction");

  const itemKey = input.itemKey ?? "__run__";
  const dup = await prisma.aiApprovalDecision.findUnique({
    where: { extractionId_itemKey: { extractionId: input.extractionId, itemKey } },
  });
  if (dup) throw ConflictError("A decision already exists for this item.");

  await prisma.$transaction([
    prisma.aiApprovalDecision.create({
      data: {
        extractionId: extraction.id,
        decision: input.decision,
        decidedByUserId: actorUserId,
        note: input.note ?? null,
        itemKey, // "__run__" sentinel keeps the whole-run decision unique
        correctedValue: (input.correctedValue ?? undefined) as never,
      },
    }),
    prisma.aiExtraction.update({
      where: { id: extraction.id },
      data: {
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
      },
    }),
  ]);

  await recordAudit({
    action: "ai_extraction.decision",
    entityType: "AiExtraction",
    entityId: extraction.id,
    oldValue: "pending",
    newValue: JSON.stringify({ decision: input.decision, itemKey: input.itemKey ?? "run" }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  // Extraction run status reflects the whole-run decision only.
  if (!input.itemKey && ["approve", "reject", "partially_approved"].includes(input.decision)) {
    const statusValue = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "needs_review";
    const statusId = (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "extraction_status", value: statusValue } } })).id;
    await prisma.aiExtraction.update({ where: { id: extraction.id }, data: { status: statusId } });
  }

  // User-requested pipeline completion (Phase 9.1): approving a
  // `findingStatus:<idx>` item CREATES/UPDATES the tracker finding with the
  // AI-proposed values — the human approval is the gate; the AI did not write
  // alone. Rejections never touch the tracker.
  if (input.decision === "approve" && input.itemKey?.startsWith("findingStatus:")) {
    try {
      const { applyApprovedFinding } = await import("@/lib/services/finding-apply-service");
      const result = await applyApprovedFinding({ extractionId: extraction.id, itemKey: input.itemKey! }, actorUserId);
      await recordAudit({
        action: "ai_approval.finding_applied",
        entityType: "Finding",
        entityId: result.findingId,
        newValue: JSON.stringify({ extractionId: extraction.id, itemKey: input.itemKey, code: result.code, created: result.created, iterationState: result.iterationLabel }),
        source: "HUMAN",
        actorUserId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (error) {
      // The approval decision stands; only the tracker write reports honestly.
      await recordAudit({
        action: "ai_approval.finding_apply_failed",
        entityType: "AiExtraction",
        entityId: extraction.id,
        newValue: JSON.stringify({ itemKey: input.itemKey, reason: String((error as Error).message ?? error).slice(0, 240) }),
        source: "SYSTEM",
        actorUserId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }
  }
}

export async function listExtractions(statusValue?: string) {
  const rows = await prisma.aiExtraction.findMany({
    where: statusValue
      ? { statusRef: { value: statusValue } }
      : undefined,
    include: { statusRef: true, evidence: true, approvals: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows;
}
