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

export interface ApprovalApplyFailure {
  itemKey: string;
  reason: string;
}

export interface ApprovalDecisionResult {
  applied: { itemKey: string; findingId: number; code: string; created: boolean; iterationLabel: string }[];
  failed: ApprovalApplyFailure[];
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
): Promise<ApprovalDecisionResult> {
  const extraction = await prisma.aiExtraction.findUnique({ where: { id: input.extractionId } });
  if (!extraction) throw NotFoundError("AI extraction");
  const applied: ApprovalDecisionResult["applied"] = [];
  const failed: ApprovalApplyFailure[] = [];

  const itemKey = input.itemKey ?? "__run__";
  const dup = await prisma.aiApprovalDecision.findUnique({
    where: { extractionId_itemKey: { extractionId: input.extractionId, itemKey } },
  });
  // Idempotent RE-APPLY (precise fix 2026-11): a participantRole decision that
  // RECORDED but never APPLIED (e.g. an apply-side failure swallowed by the
  // honest-failure rule) must not wedge the item behind a 409 forever. When
  // the participant is still UNKNOWN (no effective role was ever written),
  // a repeated approve re-runs the apply instead of conflicting.
  if (dup) {
    const reApplicable =
      dup.decision === "approve" &&
      input.decision === "approve" &&
      input.itemKey?.startsWith("participantRole:") === true;
    if (reApplicable) {
      try {
        const { applyParticipantRoleDecision } = await import("@/lib/services/participant-role-apply-service");
        const result = await applyParticipantRoleDecision(
          { extractionId: extraction.id, itemKey: input.itemKey!, correctedRoleValue: null },
          actorUserId,
        );
        if (result.changed) {
          await recordAudit({
            action: "ai_approval.participant_role_applied",
            entityType: "EmailParticipant",
            entityId: result.participantId,
            newValue: JSON.stringify({ extractionId: extraction.id, itemKey: input.itemKey, role: result.role, roleSource: result.roleSource, via: "re_apply" }),
            source: "HUMAN",
            actorUserId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
          return { applied: [], failed: [] };
        }
      } catch {
        // fall through to the conflict below — the decision record stands
      }
    }
    throw ConflictError("A decision already exists for this item.");
  }

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

  // Whole-run APPROVE also applies every finding candidate to the PT Tracker,
  // so the tracker cells reflect the analysis without requiring per-item
  // clicks. Human approval is still the gate (this only runs on an explicit
  // approve decision). Already-applied items are skipped (duplicate decisions).
  // UNIVERSAL (user-directed 2026-11): the run-level approve ALSO applies every
  // participant-role proposal (promote-from-UNKNOWN; human overrides always
  // win) — "Approve all candidates" must mean findings AND roles, on every app.
  if (!input.itemKey && input.decision === "approve") {
    const structured = (extraction.structuredOutput ?? null) as
      | { findings?: unknown[]; participants?: { email?: string; proposedRole?: string }[] }
      | null;
    const count = Array.isArray(structured?.findings) ? structured!.findings!.length : 0;
    // Deterministic application order: earliest evidence mail first. When the
    // SAME finding appears in two summaries of one thread (an iteration-1
    // report later superseded by a corrected report or retest table), the
    // LATER summary is applied last and wins — chronological truth instead of
    // the model's emission order. Per-iteration states keep both versions;
    // history keeps the transition.
    const minEvidenceIndex = (i: number): number => {
      const f = structured!.findings![i] as { evidence?: { messageIndex?: number }[] } | null | undefined;
      const idxs = Array.isArray(f?.evidence) ? f!.evidence!.map((e) => Number(e?.messageIndex ?? Number.MAX_SAFE_INTEGER)) : [];
      return idxs.length ? Math.min(...idxs) : Number.MAX_SAFE_INTEGER;
    };
    const orderedIndices = Array.from({ length: count }, (_, i) => i).sort(
      (a, b) => minEvidenceIndex(a) - minEvidenceIndex(b),
    );
    for (const i of orderedIndices) {
      const itemKey = `findingStatus:${i}`;
      const dup = await prisma.aiApprovalDecision.findUnique({
        where: { extractionId_itemKey: { extractionId: extraction.id, itemKey } },
      });
      if (dup) continue;
      try {
        await prisma.aiApprovalDecision.create({
          data: {
            extractionId: extraction.id,
            decision: "approve",
            decidedByUserId: actorUserId,
            itemKey,
          },
        });
        const { applyApprovedFinding } = await import("@/lib/services/finding-apply-service");
        const result = await applyApprovedFinding({ extractionId: extraction.id, itemKey }, actorUserId);
        applied.push({ itemKey, findingId: result.findingId, code: result.code, created: result.created, iterationLabel: result.iterationLabel });
        await recordAudit({
          action: "ai_approval.finding_applied",
          entityType: "Finding",
          entityId: result.findingId,
          newValue: JSON.stringify({ extractionId: extraction.id, itemKey, code: result.code, created: result.created, iterationState: result.iterationLabel, via: "whole_run" }),
          source: "HUMAN",
          actorUserId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      } catch (error) {
        failed.push({ itemKey, reason: String((error as Error).message ?? error).slice(0, 240) });
        await recordAudit({
          action: "ai_approval.finding_apply_failed",
          entityType: "AiExtraction",
          entityId: extraction.id,
          newValue: JSON.stringify({ itemKey, reason: String((error as Error).message ?? error).slice(0, 240) }),
          source: "SYSTEM",
          actorUserId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
    }

    // Participant roles — part of the same run-level human decision.
    try {
      const { applyParticipantRoleDecision } = await import("@/lib/services/participant-role-apply-service");
      const participants = Array.isArray(structured?.participants) ? structured!.participants! : [];
      for (let i = 0; i < participants.length; i += 1) {
        const email = (participants[i]?.email ?? "").toLowerCase().trim();
        if (!email) continue;
        const itemKey = `participantRole:${email}#${i}`;
        const dup = await prisma.aiApprovalDecision.findUnique({
          where: { extractionId_itemKey: { extractionId: extraction.id, itemKey } },
        });
        if (!dup) {
          await prisma.aiApprovalDecision.create({
            data: { extractionId: extraction.id, decision: "approve", decidedByUserId: actorUserId, itemKey },
          });
        }
        try {
          const result = await applyParticipantRoleDecision(
            { extractionId: extraction.id, itemKey, correctedRoleValue: null },
            actorUserId,
          );
          if (result.changed) {
            await recordAudit({
              action: "ai_approval.participant_role_applied",
              entityType: "EmailParticipant",
              entityId: result.participantId,
              newValue: JSON.stringify({ extractionId: extraction.id, itemKey, role: result.role, roleSource: result.roleSource, via: "whole_run" }),
              source: "HUMAN",
              actorUserId,
              ip: ctx.ip,
              userAgent: ctx.userAgent,
            });
          }
        } catch {
          // Honest-failure rule: the decision stands; the apply reports via audit.
          await recordAudit({
            action: "ai_approval.participant_role_apply_failed",
            entityType: "AiExtraction",
            entityId: extraction.id,
            newValue: JSON.stringify({ itemKey, via: "whole_run" }),
            source: "SYSTEM",
            actorUserId,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
      }
    } catch {
      // Never let role application break the run-level decision response.
    }

    // Engagement-record fields — part of the same run-level human decision
    // (user-directed: "I want all these by AI"). Fill-only per field.
    try {
      const record = (structured as { engagementRecord?: Record<string, unknown> | null } | null)?.engagementRecord ?? null;
      if (record && typeof record === "object") {
        const { applyEngagementRecordField } = await import("@/lib/services/engagement-record-apply-service");
        for (const field of ["mailSubject", "requestedDate", "scanReportDate", "iteration1Date", "iteration2Date", "comments", "followUpDate", "followUpResponse", "primaryPoc", "assignedMembers"]) {
          const raw = record[field];
          const hasValue = typeof raw === "string" && raw.trim().length > 0 && raw.trim() !== "—";
          if (!hasValue) continue;
          const itemKey = `engagementRecord:${field}`;
          const dup = await prisma.aiApprovalDecision.findUnique({
            where: { extractionId_itemKey: { extractionId: extraction.id, itemKey } },
          });
          if (!dup) {
            await prisma.aiApprovalDecision.create({
              data: { extractionId: extraction.id, decision: "approve", decidedByUserId: actorUserId, itemKey },
            });
          }
          try {
            const result = await applyEngagementRecordField(
              { extractionId: extraction.id, field, correctedValue: null },
              actorUserId,
            );
            if (result.applied) {
              await recordAudit({
                action: "engagement_record.field_applied",
                entityType: "Application",
                entityId: extraction.applicationId ?? null,
                fieldName: field,
                newValue: String(result.value ?? "").slice(0, 500),
                source: "HUMAN",
                actorUserId,
                ip: ctx.ip,
                userAgent: ctx.userAgent,
                index: { extractionId: extraction.id, via: "whole_run" },
              });
            }
          } catch {
            await recordAudit({
              action: "engagement_record.apply_failed",
              entityType: "AiExtraction",
              entityId: extraction.id,
              newValue: JSON.stringify({ itemKey, via: "whole_run" }),
              source: "SYSTEM",
              actorUserId,
              ip: ctx.ip,
              userAgent: ctx.userAgent,
            });
          }
        }
      }
    } catch {
      // Never let record application break the run-level decision response.
    }
  }

  // User-requested pipeline completion (Phase 9.1): approving a
  // `participantRole:<email>#<idx>` item APPLIES the AI-proposed role to the
  // participant row (promote-from-UNKNOWN; human overrides always win).
  // Rejections/corrections must not silently change data — a correction is
  // expressed as the correctedValue role and applied identically.
  if (input.itemKey?.startsWith("participantRole:")) {
    try {
      const { applyParticipantRoleDecision } = await import("@/lib/services/participant-role-apply-service");
      const roleForApply =
        input.decision === "approve"
          ? null // use the AI proposed role from the extraction
          : typeof input.correctedValue === "string" && input.correctedValue.trim().length > 0
            ? input.correctedValue.trim()
            : null;
      const result = await applyParticipantRoleDecision(
        { extractionId: extraction.id, itemKey: input.itemKey!, correctedRoleValue: roleForApply },
        actorUserId,
      );
      if (result.changed) {
        await recordAudit({
          action: "ai_approval.participant_role_applied",
          entityType: "EmailParticipant",
          entityId: result.participantId,
          newValue: JSON.stringify({ extractionId: extraction.id, itemKey: input.itemKey, role: result.role, roleSource: result.roleSource }),
          source: "HUMAN",
          actorUserId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      } else {
        await recordAudit({
          action: "ai_approval.participant_role_skipped",
          entityType: "EmailParticipant",
          entityId: result.participantId,
          newValue: JSON.stringify({ itemKey: input.itemKey, reason: result.reason }),
          source: "SYSTEM",
          actorUserId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
    } catch {
      // Honest-failure rule: the decision itself already stands in the logs.
    }
  }

  // User-requested pipeline completion (Phase 9.1): approving a
  // `findingStatus:<idx>` item CREATES/UPDATES the tracker finding with the
  // AI-proposed values — the human approval is the gate; the AI did not write
  // alone. Rejections never touch the tracker.
  // A human CORRECTION with a correctedValue status applies the finding with
  // the corrected status (this is how "AI could not read the status" items get
  // their verdict — the human supplies it, the gate stays).
  if (input.itemKey?.startsWith("findingStatus:") && (input.decision === "approve" || input.decision === "correct")) {
    try {
      const { applyApprovedFinding } = await import("@/lib/services/finding-apply-service");
      const correctedStatus =
        input.decision === "correct" && typeof input.correctedValue === "string" && input.correctedValue.trim().length > 0
          ? input.correctedValue.trim()
          : null;
      if (input.decision === "correct" && correctedStatus === null) {
        throw ValidationError("CORRECT on a finding requires a correctedValue status (fixed / not_fixed / open / …).");
      }
      const result = await applyApprovedFinding({ extractionId: extraction.id, itemKey: input.itemKey!, correctedStatusSignal: correctedStatus }, actorUserId);
      applied.push({ itemKey: input.itemKey, findingId: result.findingId, code: result.code, created: result.created, iterationLabel: result.iterationLabel });
      await recordAudit({
        action: input.decision === "correct" ? "ai_approval.finding_corrected_applied" : "ai_approval.finding_applied",
        entityType: "Finding",
        entityId: result.findingId,
        newValue: JSON.stringify({ extractionId: extraction.id, itemKey: input.itemKey, code: result.code, created: result.created, iterationState: result.iterationLabel, corrected: correctedStatus ?? undefined }),
        source: "HUMAN",
        actorUserId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (error) {
      failed.push({ itemKey: input.itemKey, reason: String((error as Error).message ?? error).slice(0, 240) });
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

  // Engagement-record fields (user-directed 2026-11 — "I want all these by AI"):
  // approving/correcting an `engagementRecord:<field>` item writes that field
  // to the application record (mail subject, POC, assigned members, dates,
  // comments, follow-ups). Approve = fill-only (never overwrites an existing
  // record value); Correct = the human value replaces it. Reject = no-op.
  if (input.itemKey?.startsWith("engagementRecord:") && (input.decision === "approve" || input.decision === "correct")) {
    const field = input.itemKey.slice("engagementRecord:".length);
    try {
      const { applyEngagementRecordField } = await import("@/lib/services/engagement-record-apply-service");
      const correctedValue = input.decision === "correct" && typeof input.correctedValue === "string" ? input.correctedValue : null;
      if (input.decision === "correct" && (!correctedValue || correctedValue.trim().length === 0)) {
        throw ValidationError("CORRECT on an engagement-record field requires a corrected value.");
      }
      const result = await applyEngagementRecordField(
        { extractionId: extraction.id, field, correctedValue },
        actorUserId,
      );
      if (result.applied) {
        await recordAudit({
          action: "engagement_record.field_applied",
          entityType: "Application",
          entityId: extraction.applicationId ?? null,
          fieldName: field,
          newValue: String(result.value ?? "").slice(0, 500),
          source: "HUMAN",
          actorUserId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          index: { extractionId: extraction.id, itemKey: input.itemKey, via: input.decision === "correct" ? "correct" : "approve" },
        });
      } else {
        await recordAudit({
          action: "engagement_record.field_skipped",
          entityType: "Application",
          entityId: extraction.applicationId ?? null,
          fieldName: field,
          newValue: result.reason ?? null,
          source: "SYSTEM",
          actorUserId,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
    } catch (error) {
      failed.push({ itemKey: input.itemKey, reason: String((error as Error).message ?? error).slice(0, 240) });
      await recordAudit({
        action: "engagement_record.apply_failed",
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

  return { applied, failed };
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
