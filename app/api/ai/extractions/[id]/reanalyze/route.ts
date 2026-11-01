import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { analyzeThread } from "@/lib/ai/analysis-service";

const BodySchema = z.object({ threadId: z.number().int().positive() });

/**
 * POST /api/ai/extractions/[id]/reanalyze (Phase 5 §46) — creates a NEW run for
 * the same thread. The previous extraction (and its evidence/corrections) stays.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id } = await params;
    const previous = await prisma.aiExtraction.findUnique({ where: { id: Number(id) }, select: { id: true, threadId: true } });
    if (!previous) {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Extraction not found." } }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const input = BodySchema.safeParse({ threadId: body?.threadId ?? previous.threadId });
    if (!input.success || !input.data.threadId) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "threadId missing (and no prior run to inherit)." } }, { status: 422 });
    }
    const providerOverride = request.headers.get("x-ai-provider-override");
    const run = await analyzeThread({
      threadId: input.data.threadId,
      userId: Number(session.sub),
      ctx: { ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined },
      providerOverrideSlug: providerOverride ?? undefined,
    });
    return NextResponse.json({ success: true, previousExtractionId: previous.id, newExtractionId: run.extractionId });
  } catch (error) {
    return toErrorResponse(error);
  }
}
