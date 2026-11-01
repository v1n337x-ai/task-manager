import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { findItemDecisions, runDecision } from "@/lib/services/ai-review-service";

/** GET /api/ai/extractions/[id] — extraction + evidence + item decisions. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionH(request);
    const { id } = await params;
    const extractionId = Number(id);
    const extraction = await prisma.aiExtraction.findUnique({
      where: { id: extractionId },
      include: {
        thread: { select: { id: true, subject: true } },
        statusRef: true,
        evidence: { orderBy: { id: "asc" } },
        approvals: { orderBy: { createdAt: "asc" } },
        application: { select: { id: true, displayName: true } },
      },
    });
    if (!extraction) throw NotFoundError("AI extraction");

    const decisions = findItemDecisions(extraction.approvals);
    return NextResponse.json({
      extraction: {
        id: extraction.id,
        threadId: extraction.threadId,
        threadSubject: extraction.thread?.subject ?? null,
        applicationId: extraction.applicationId,
        applicationName: extraction.application?.displayName ?? null,
        providerSlug: extraction.providerSlug,
        schemaVersion: extraction.schemaVersion,
        promptVersion: extraction.promptVersion,
        inputContextHash: extraction.inputContextHash,
        statusValue: extraction.statusRef.value,
        errorMessage: extraction.errorMessage,
        confidence: extraction.confidence,
        durationMs: extraction.durationMs,
        createdAt: extraction.createdAt.toISOString(),
        structured: extraction.structuredOutput,
      },
      evidence: extraction.evidence,
      itemDecisions: decisions,
      runDecision: runDecision(extraction.approvals),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
