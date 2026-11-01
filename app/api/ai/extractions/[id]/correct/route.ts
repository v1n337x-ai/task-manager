import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { recordApprovalDecision } from "@/lib/services/ai-foundation-service";
import { ValidationError } from "@/lib/errors";

const BodySchema = z.object({
  extractionId: z.number().int().positive(),
  itemKey: z.string().max(300).min(1), // CORRECT is ALWAYS item-level (§42/§74/§75)
  correctedValue: z.unknown(),
  note: z.string().max(2000).optional(),
});

/**
 * POST /api/ai/extractions/[id]/correct — human CORRECTION at item level.
 * The AI value is preserved beside the correction (§42/§75) — never replaced.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const input = BodySchema.safeParse({ ...(body ?? {}), extractionId: Number(id) });
    if (!input.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "itemKey + correctedValue are required for corrections." } },
        { status: 422 },
      );
    }
    if (input.data.correctedValue === undefined) throw ValidationError("correctedValue is required for a correction.");
    await recordApprovalDecision(
      {
        extractionId: input.data.extractionId,
        decision: "correct",
        note: input.data.note ?? null,
        itemKey: input.data.itemKey,
        correctedValue: input.data.correctedValue,
      },
      Number(session.sub),
      { ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined },
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
