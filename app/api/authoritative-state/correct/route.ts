import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { recordAuthoritativeDecision } from "@/lib/services/authoritative-state/finding-state";

const BodySchema = z.object({
  entityType: z.enum(["finding", "test_case", "iteration"]),
  entityId: z.number().int().positive(),
  iterationId: z.number().int().positive().nullable().optional(),
  iterationNumber: z.number().int().positive().nullable().optional(),
  newState: z.string().max(40),
  correctedValue: z.unknown().nullable().optional(), // §42: correction payload recorded beside AI value
  resolutionMethod: z.enum(["EXPLICIT_COMMUNICATION", "INFERRED_CONTEXT", "HUMAN_CORRECTION", "AI_APPROVED", "SYSTEM_DEFAULT"]).optional(),
  sourceMessageId: z.number().int().positive().nullable().optional(),
  sourceThreadId: z.number().int().positive().nullable().optional(),
  aiExtractionId: z.number().int().positive().nullable().optional(),
  evidenceRef: z.array(z.object({ excerpt: z.string().max(900), messageIndex: z.number().int().optional() })).nullable().optional(),
  reason: z.string().max(2000).min(3), // CORRECT mandates a reason (§75)
});

/**
 * POST /api/authoritative-state/correct (Phase 6 §26/§42/§75) — HUMAN_CORRECTION
 * always takes precedence; the AI/previous values are preserved in history.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const input = BodySchema.safeParse(body ?? {});
    if (!input.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Validation failed.", details: input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } },
        { status: 422 },
      );
    }
    const result = await recordAuthoritativeDecision({
      entityType: input.data.entityType,
      entityId: input.data.entityId,
      iterationId: input.data.iterationId ?? null,
      iterationNumber: input.data.iterationNumber ?? null,
      newState: input.data.newState,
      resolutionMethod: input.data.resolutionMethod ?? "HUMAN_CORRECTION",
      decisionSource: "HUMAN_CORRECTION",
      sourceMessageId: input.data.sourceMessageId ?? null,
      sourceThreadId: input.data.sourceThreadId ?? null,
      aiExtractionId: input.data.aiExtractionId ?? null,
      evidenceRef: input.data.evidenceRef ?? null,
      approvedByUserId: Number(session.sub),
      reason: input.data.reason,
    });
    return NextResponse.json({ success: true, decisionId: result.id, created: result.created });
  } catch (error) {
    return toErrorResponse(error);
  }
}
