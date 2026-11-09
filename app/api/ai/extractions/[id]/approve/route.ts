import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { recordApprovalDecision } from "@/lib/services/ai-foundation-service";
import { ValidationError } from "@/lib/errors";

const BodySchema = z.object({
  extractionId: z.number().int().positive(),
  decision: z.enum(["approve", "reject", "correct", "partially_approved"]),
  note: z.string().max(2000).optional(),
  itemKey: z.string().max(300).optional(), // absent = whole run (§74 item-level allowed)
  correctedValue: z.unknown().optional(), // required for CORRECT at item level
});

/**
 * POST /api/ai/extractions/[id]/approve — item-level or whole-run APPROVE.
 * Human approval never feeds back into AI-supplied output mutation — a decision
 * record is created; the AI payload remains immutable (§42/§75).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id } = await params;
    const extractionId = Number(id);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const input = BodySchema.safeParse({ ...(body ?? {}), extractionId });
    if (!input.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Validation failed.", details: input.error.issues } },
        { status: 422 },
      );
    }
    if (input.data.decision === "correct" && input.data.correctedValue === undefined) {
      throw ValidationError("CORRECT decisions require correctedValue.");
    }
    if (input.data.itemKey && input.data.decision === "correct" && input.data.correctedValue === undefined) {
      throw ValidationError("Item CORRECT decisions require correctedValue.");
    }

    const result = await recordApprovalDecision(
      {
        extractionId,
        decision: input.data.decision,
        note: input.data.note ?? null,
        itemKey: input.data.itemKey ?? null,
        correctedValue: input.data.correctedValue,
      },
      Number(session.sub),
      {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    );
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
