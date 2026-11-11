/**
 * applyApprovedFinding (Phase 9.1 pipeline completion, user-requested):
 * when a human APPROVES an AI `findingStatus:<idx>` item, the AI candidate is
 * applied to the PT Tracker as a REAL finding + iteration state. Strictly
 * human-gated (this function runs only from recordApprovalDecision approve),
 * so the AI still never mutates VAPT data by itself — the human decision is
 * the authorizing action (decisionSource AI_APPROVED semantics).
 */
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { createFinding, setFindingIterationState } from "@/lib/services/finding-service";

import { isGenericFindingTitle, titleSupportedByEvidence } from "@/lib/ai/finding-quality";

export interface ApplyResult {
  findingId: number;
  code: string;
  created: boolean;
  iterationLabel: string;
}

function normalizeEvidenceText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function assertEvidenceExcerptsAreVerbatim(
  extraction: { threadId: number | null; sourceMessageId: number | null },
  evidence: Array<{ messageIndex: number; excerpt: string }>,
): Promise<void> {
  let bodies: string[] = [];

  if (extraction.threadId) {
    const messages = await prisma.emailMessage.findMany({
      where: { threadId: extraction.threadId },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      select: { bodyText: true, bodyHtml: true },
    });
    // Evidence indexes address the newest 12 messages given to the model.
    bodies = messages.slice(-12).map((message) => message.bodyText ?? message.bodyHtml ?? "");
  } else if (extraction.sourceMessageId) {
    const message = await prisma.emailMessage.findUnique({
      where: { id: extraction.sourceMessageId },
      select: { bodyText: true, bodyHtml: true },
    });
    if (message) bodies = [message.bodyText ?? message.bodyHtml ?? ""];
  }

  if (bodies.length === 0) return;
  for (const item of evidence) {
    const body = bodies[item.messageIndex];
    if (!body) throw ValidationError(`AI evidence references missing message #${item.messageIndex}.`);
    if (!normalizeEvidenceText(body).includes(normalizeEvidenceText(item.excerpt))) {
      throw ValidationError(`AI evidence excerpt is not a verbatim substring of message #${item.messageIndex}.`);
    }
  }
}

export async function applyApprovedFinding(
  params: { extractionId: number; itemKey: string; correctedStatusSignal?: string | null },
  actorUserId: number,
  ctx: { source?: "HUMAN" | "EXCEL_IMPORT" | "EML" | "AI" | "SYSTEM" } = { source: "AI" },
): Promise<ApplyResult> {
  void ctx; // reserved for downstream contexts; the audit lives in the caller
  const index = Number.parseInt(params.itemKey.split(":")[1] ?? "", 10);
  if (!Number.isInteger(index)) throw ValidationError("Malformed findingStatus item key.");

  const extraction = await prisma.aiExtraction.findUnique({ where: { id: params.extractionId } });
  if (!extraction) throw ValidationError("AI extraction not found.");
  const structured = (extraction.structuredOutput ?? null) as { findings?: unknown[] } | null;
  const item = structured?.findings?.[index] as
    | {
        identifierExplicit?: unknown;
        identifierMark?: unknown;
        title?: unknown;
        titleMark?: unknown;
        severity?: unknown;
        severityMark?: unknown;
        description?: unknown;
        statusSignal?: unknown;
        iterationSignal?: unknown;
        iterationSignalExplicit?: unknown;
        isNewFindingCandidate?: unknown;
        evidence?: unknown;
      }
    | undefined;
  if (!item) throw ValidationError(`Extraction has no finding item #${index}.`);

  const title = typeof item.title === "string" ? item.title.trim().slice(0, 280) : "";
  if (title.length < 3) throw ValidationError("The approved AI finding has an unusable title.");

  const rawEvidence = Array.isArray(item.evidence) ? item.evidence : [];
  const evidence = rawEvidence.filter((candidate): candidate is { messageIndex: number; excerpt: string } =>
    typeof candidate === "object" && candidate !== null &&
    Number.isInteger((candidate as { messageIndex?: unknown }).messageIndex) &&
    typeof (candidate as { excerpt?: unknown }).excerpt === "string" &&
    (candidate as { excerpt: string }).excerpt.trim().length >= 3,
  );
  if (evidence.length === 0) throw ValidationError("The approved AI finding has no usable source evidence.");
  await assertEvidenceExcerptsAreVerbatim(extraction, evidence);

  const identifierExplicit = typeof item.identifierExplicit === "string" && item.identifierExplicit.trim().length > 0
    ? item.identifierExplicit.trim().slice(0, 32)
    : null;
  const identifierMark = typeof item.identifierMark === "string" ? item.identifierMark : "IDENTIFIER_NOT_EXPLICIT";
  if (identifierExplicit && identifierMark !== "IDENTIFIER_EXPLICIT") {
    throw ValidationError("The approved AI finding has an explicit identifier but is marked as not explicit.");
  }
  const titleMark = typeof item.titleMark === "string" ? item.titleMark : "AI_PROPOSED";
  if (!identifierExplicit && isGenericFindingTitle(title)) {
    throw ValidationError("The approved AI candidate is a generic remediation/status summary, not a concrete vulnerability finding.");
  }
  if (!identifierExplicit && identifierMark !== "IDENTIFIER_EXPLICIT" && titleMark !== "EXPLICIT" && !titleSupportedByEvidence(title, evidence)) {
    throw ValidationError("The AI-proposed finding title is not sufficiently supported by the quoted evidence.");
  }

  const severityValue = typeof item.severity === "string" ? item.severity : "unknown";
  type Sev = "critical" | "high" | "medium" | "low" | "info";
  if (!["critical", "high", "medium", "low", "info"].includes(severityValue)) {
    throw ValidationError("The approved AI finding has unknown severity and cannot be applied.");
  }
  const finalSeverity = severityValue as Sev;
  const STATUS_UNION = ["fixed", "unknown", "open", "not_fixed", "not_retested", "new", "removed", "out_of_scope", "not_applicable", "accepted_risk"] as const;
  type StatusV = (typeof STATUS_UNION)[number];
  // A human CORRECTION supplies the status when the AI could not extract one
  // (no valid statusSignal). The correction must itself be a legal status —
  // the human gate replaces the missing AI signal, it never bypasses the
  // vocabulary.
  const correctedRaw = typeof params.correctedStatusSignal === "string" ? params.correctedStatusSignal.trim().toLowerCase() : null;
  if (correctedRaw !== null && !STATUS_UNION.includes(correctedRaw as StatusV)) {
    throw ValidationError(`Corrected status "${correctedRaw}" is not a valid finding status.`);
  }
  if (correctedRaw === null && (typeof item.statusSignal !== "string" || !STATUS_UNION.includes(item.statusSignal as StatusV))) {
    throw ValidationError("The approved AI finding has no valid status signal.");
  }
  const statusValue = (correctedRaw ?? (item.statusSignal as string | null) ?? "") as StatusV;
  const evidenceText = evidence.map((item) => item.excerpt).join(" ");
  let iterationNumber: number | null =
    typeof item.iterationSignal === "number" &&
    Number.isInteger(item.iterationSignal) &&
    item.iterationSignal >= 1 &&
    item.iterationSignal <= 2
      ? item.iterationSignal
      : null;
  if (iterationNumber === null && /retest|iteration\s*2/i.test(evidenceText) && ["fixed", "not_fixed"].includes(statusValue)) {
    iterationNumber = 2;
  }
  if (iterationNumber === null && /iteration\s*1/i.test(evidenceText)) iterationNumber = 1;
  if (iterationNumber === null || (typeof item.iterationSignal === "number" && item.iterationSignalExplicit !== true && iterationNumber !== item.iterationSignal)) {
    throw ValidationError("The approved AI finding must reference Iteration 1 or Iteration 2 explicitly.");
  }
  const isNewFindingCandidate = item.isNewFindingCandidate === true;
  const firstSeenIterationNumber = isNewFindingCandidate ? iterationNumber : Math.min(iterationNumber, 1);

  // The candidate belongs to the thread's application; without one the item
  // cannot be attached to any tracker (honest skip, audit explains).
  const applicationId = extraction.applicationId;
  if (!applicationId) throw ValidationError("The thread has no application linkage — cannot attach the approved finding.");

  // Match an existing finding by explicit code first, then by normalized title.
  // An explicit code is a stable identity: a status-only update for that code
  // must not create a duplicate just because the AI paraphrased its title.
  let findingId: number | null = null;
  let code = "";
  let created = false;
  const candidates = await prisma.finding.findMany({
    where: { applicationId },
    select: { id: true, code: true, title: true, firstSeenIterationNumber: true },
  });
  const normalized = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200);
  const hit = (identifierExplicit
    ? candidates.find((c) => c.code.toLowerCase() === identifierExplicit.toLowerCase())
    : undefined)
    ?? (!isGenericFindingTitle(title) ? candidates.find((c) => normalized(c.title) === normalized(title)) : undefined);
  if (hit) {
    findingId = hit.id;
    code = hit.code;
    if (hit.firstSeenIterationNumber !== firstSeenIterationNumber) {
      await prisma.finding.update({
        where: { id: hit.id },
        data: { firstSeenIterationNumber },
      });
    }
  }
  if (findingId === null) {
    if (isGenericFindingTitle(title)) {
      throw ValidationError("The approved AI candidate is a generic remediation/status summary, not a concrete vulnerability finding.");
    }
    const createdRow = await createFinding(
      {
        applicationId,
        code: identifierExplicit && /^F-\d+$/i.test(identifierExplicit) ? identifierExplicit.toUpperCase() : undefined,
        title,
        severityValue: finalSeverity,
        description: typeof item.description === "string" && item.description.length > 0 ? item.description.slice(0, 3800) : undefined,
        firstSeenIterationNumber,
      },
      actorUserId,
      {},
    );
    findingId = createdRow.id;
    code = createdRow.code;
    created = true;
  }

  // Resolve the target iteration (I1 or I2), provisioning the container when
  // the application has none yet — same behavior as the Excel finding import.
  const { ensureIterations } = await import("./finding-import-service");
  const { i1, i2 } = await ensureIterations(applicationId, actorUserId);
  const iterationId = iterationNumber === 2 && i2 !== null ? i2 : i1;
  const iterationLabel = iterationId === i2 ? "I2" : "I1";

  await setFindingIterationState(
    { findingId: findingId!, iterationId, severityValue: finalSeverity, statusValue },
    actorUserId,
    { source: "AI" },
  );

  // User-directed (pipeline completion): an approved finding also seeds the
  // engagement "Comments" (Excel export column R) from the analyzed thread
  // summary — ONLY when Comments are still empty. Append-only rule: existing
  // notes are never overwritten, so no VAPT history can be destroyed.
  const structuredOut = (extraction.structuredOutput ?? null) as { threadSummary?: unknown } | null;
  const threadSummary = typeof structuredOut?.threadSummary === "string" ? structuredOut.threadSummary.trim() : "";
  if (extraction.threadId !== null && threadSummary.length >= 10) {
    const engagement = await prisma.engagement.findFirst({
      where: { applicationId, isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, notes: true },
    });
    if (engagement && (engagement.notes === null || engagement.notes.trim() === "")) {
      const thread = await prisma.emailThread.findUnique({
        where: { id: extraction.threadId },
        select: { subject: true },
      });
      const withSubject = thread?.subject ? `${thread.subject}\n\n${threadSummary}` : threadSummary;
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { notes: withSubject.slice(0, 3800) },
      });
    }
  }

  return { findingId: findingId!, code, created, iterationLabel };
}
