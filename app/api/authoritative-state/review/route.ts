import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";

/**
 * GET /api/authoritative-state/review?applicationId=N (Phase 6 §27/§28) —
 * review queue: latest authoritative decisions + AI proposals per application.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const applicationId = Number(url.searchParams.get("applicationId"));
    if (!Number.isInteger(applicationId) || applicationId <= 0) throw ValidationError("applicationId is required.");

    const entities: string[] = ["finding", "test_case", "iteration"];
    const decisions = await prisma.authoritativeStateDecision.findMany({
      where: {
        OR: [
          { entityType: "finding", entityId: { in: (await findingIds(applicationId)) } },
          { entityType: "test_case", entityId: { in: (await testCaseIds(applicationId)) } },
          { entityType: "iteration", entityId: { in: (await iterationIds(applicationId)) } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      decisions: decisions.map((d) => ({
        id: d.id,
        entityType: d.entityType,
        entityId: d.entityId,
        iterationNumber: d.iterationNumber,
        previousState: d.previousState,
        newState: d.newState,
        verification: d.verification,
        decisionSource: d.decisionSource,
        resolutionMethod: d.resolutionMethod,
        sourceMessageId: d.sourceMessageId,
        approvedByUserId: d.approvedByUserId,
        approvedAt: d.approvedAt?.toISOString() ?? null,
        reason: d.reason,
      })),
      notifiedTypes: entities,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function findingIds(applicationId: number): Promise<number[]> {
  const rows = await prisma.finding.findMany({ where: { applicationId }, select: { id: true } });
  return rows.map((r) => r.id);
}
async function testCaseIds(applicationId: number): Promise<number[]> {
  const rows = await prisma.testCase.findMany({ where: { applicationId }, select: { id: true } });
  return rows.map((r) => r.id);
}
async function iterationIds(applicationId: number): Promise<number[]> {
  const rows = await prisma.iteration.findMany({ where: { engagement: { applicationId } }, select: { id: true } });
  return rows.map((r) => r.id);
}
