import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { recordAuthoritativeDecision, calculateAuthoritativeFindingState, recalculateFindingProjection } from "@/lib/services/authoritative-state/finding-state";

const BodySchema = z.object({
  findingId: z.number().int().positive(),
  newState: z.string().max(40),
  iterationId: z.number().int().positive().nullable().optional(),
  iterationNumber: z.number().int().positive().nullable().optional(),
  verification: z.enum(["DEVELOPER_REPORTED", "RETEST_VERIFIED", "NONE"]).nullable().optional(),
  resolutionMethod: z.enum(["EXPLICIT_COMMUNICATION", "INFERRED_CONTEXT", "HUMAN_CORRECTION", "AI_APPROVED", "SYSTEM_DEFAULT"]),
  decisionSource: z.enum(["STRUCTURED_DATA", "COMMUNICATION", "AI_APPROVED", "HUMAN_CORRECTION", "SYSTEM_CALCULATION"]),
  sourceMessageId: z.number().int().positive().nullable().optional(),
  sourceThreadId: z.number().int().positive().nullable().optional(),
  aiExtractionId: z.number().int().positive().nullable().optional(),
  evidenceRef: z.array(z.object({ excerpt: z.string().max(900), messageIndex: z.number().int().optional() })).nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
});

/** POST /api/authoritative-state/approve (Phase 6 §40/§41) — approval boundary. */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const input = BodySchema.safeParse({ ...(body ?? {}) });
    if (!input.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Validation failed.", details: input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } },
        { status: 422 },
      );
    }
    const result = await recordAuthoritativeDecision({
      entityType: "finding",
      entityId: input.data.findingId,
      iterationId: input.data.iterationId ?? null,
      iterationNumber: input.data.iterationNumber ?? null,
      newState: input.data.newState,
      verification: input.data.verification ?? null,
      resolutionMethod: input.data.resolutionMethod,
      decisionSource: input.data.decisionSource,
      sourceMessageId: input.data.sourceMessageId ?? null,
      sourceThreadId: input.data.sourceThreadId ?? null,
      aiExtractionId: input.data.aiExtractionId ?? null,
      evidenceRef: input.data.evidenceRef ?? null,
      approvedByUserId: Number(session.sub),
      reason: input.data.reason ?? null,
    });
    const authoritative = await calculateAuthoritativeFindingState(input.data.findingId);
    return NextResponse.json({ success: true, decisionId: result.id, created: result.created, authoritative });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET /api/authoritative-state/approve — recalculate single finding (§40/§23). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const findingId = Number(url.searchParams.get("findingId"));
    if (Number.isInteger(findingId) && findingId > 0) {
      return NextResponse.json({ authoritative: await calculateAuthoritativeFindingState(findingId) });
    }
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "findingId is required." } }, { status: 422 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const RecalcSchema = z.object({ findingId: z.number().int().positive() });

/** POST variant with recalc in body["recalculate"]. */
export async function PUT(request: NextRequest) {
  try {
    await requireSessionH(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const input = RecalcSchema.safeParse(body ?? {});
    if (!input.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "findingId required." } }, { status: 422 });
    }
    return NextResponse.json(await recalculateFindingProjection(input.data.findingId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
