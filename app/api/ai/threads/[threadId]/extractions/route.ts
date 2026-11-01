import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";

/** GET /api/ai/threads/[threadId]/extractions — versioned run history (§45/§46). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    await requireSessionH(request);
    const { threadId } = await params;
    const runs = await prisma.aiExtraction.findMany({
      where: { threadId: Number(threadId) },
      orderBy: { createdAt: "desc" },
      include: {
        statusRef: true,
        approvals: true,
        _count: { select: { evidence: true } },
      },
    });
    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        providerSlug: r.providerSlug,
        schemaVersion: r.schemaVersion,
        promptVersion: r.promptVersion,
        inputContextHash: r.inputContextHash,
        statusValue: r.statusRef.value,
        confidence: r.confidence,
        evidenceCount: r._count.evidence,
        approvals: r.approvals.map((a) => ({ itemKey: a.itemKey, decision: a.decision })),
        errorMessage: r.errorMessage,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
