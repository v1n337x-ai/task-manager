import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { setFindingIterationState } from "@/lib/services/finding-service";

/**
 * POST /api/applications/[id]/findings/bulk-verdict — ONE human action records
 * the SAME verdict on every active finding of the application for one
 * iteration (user-directed universal fix 2026-11: "I have fixed it 10 times").
 *
 * Strictly human-gated: source HUMAN, every state transition appended to the
 * per-finding history, one summary audit row. Findings already carrying the
 * exact status on that iteration are left untouched (no duplicate history).
 */
const BodySchema = z.object({
  iterationNumber: z.number().int().min(1).max(2),
  statusValue: z.enum(["open", "new", "fixed", "not_fixed", "not_retested", "removed", "out_of_scope", "not_applicable", "unknown", "accepted_risk"]),
  retestNote: z.string().max(4000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const actorUserId = Number(session.sub);
    const { id } = await params;
    const applicationId = Number(id);
    if (!Number.isInteger(applicationId)) throw ValidationError("Invalid application id.");
    const body = await request.json().catch(() => null);
    const input = BodySchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed.",
            details: input.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        },
        { status: 422 },
      );
    }

    const app = await prisma.application.findUnique({ where: { id: applicationId }, select: { id: true, displayName: true } });
    if (!app) throw NotFoundError("Application");
    const engagement = await prisma.engagement.findFirst({ where: { applicationId }, orderBy: { id: "asc" } });
    if (!engagement) throw NotFoundError("Engagement");
    const iteration = await prisma.iteration.findFirst({
      where: { engagementId: engagement.id, number: input.data.iterationNumber },
      select: { id: true, number: true },
    });
    if (!iteration) throw NotFoundError(`Iteration ${input.data.iterationNumber}`);

    const findings = await prisma.finding.findMany({
      where: { applicationId, isActive: true },
      select: { id: true, code: true, severityRef: { select: { value: true } }, iterationStates: { select: { iterationId: true, statusRef: { select: { value: true } } } } },
      orderBy: { code: "asc" },
    });

    let applied = 0;
    let unchanged = 0;
    const failed: { code: string; reason: string }[] = [];
    for (const f of findings) {
      const stateOnIteration = f.iterationStates.find((s) => s.iterationId === iteration.id);
      if (stateOnIteration?.statusRef.value === input.data.statusValue) {
        unchanged += 1;
        continue;
      }
      try {
        await setFindingIterationState(
          {
            findingId: f.id,
            iterationId: iteration.id,
            severityValue: f.severityRef.value as "critical" | "high" | "medium" | "low" | "info",
            statusValue: input.data.statusValue,
            retestNote: input.data.retestNote ?? null,
          },
          actorUserId,
          { source: "HUMAN", label: "Bulk verdict" },
        );
        applied += 1;
      } catch (error) {
        failed.push({ code: f.code, reason: String((error as Error).message ?? error).slice(0, 200) });
      }
    }

    await recordAudit({
      action: "findings.bulk_verdict",
      entityType: "Application",
      entityId: app.id,
      newValue: JSON.stringify({
        iterationNumber: iteration.number,
        statusValue: input.data.statusValue,
        applied,
        unchanged,
        failed: failed.length,
        total: findings.length,
      }),
      source: "HUMAN",
      actorUserId,
    });

    return NextResponse.json({ result: { applied, unchanged, failed, total: findings.length, iterationNumber: iteration.number, statusValue: input.data.statusValue } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
