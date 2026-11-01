import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { recordApprovalDecision } from "@/lib/services/ai-foundation-service";

const BodySchema = z.object({
  extractionId: z.number().int().positive(),
  note: z.string().max(2000).optional(),
  itemKey: z.string().max(300).optional(),
});

/** POST /api/ai/extractions/[id]/reject — item or whole-run REJECT (§73). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const input = BodySchema.safeParse({ ...(body ?? {}), extractionId: Number(id) });
    if (!input.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Validation failed." } }, { status: 422 });
    }
    await recordApprovalDecision(
      {
        extractionId: input.data.extractionId,
        decision: "reject",
        note: input.data.note ?? null,
        itemKey: input.data.itemKey ?? null,
      },
      Number(session.sub),
      { ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined },
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
