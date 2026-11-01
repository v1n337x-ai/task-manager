import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { analyzeThread } from "@/lib/ai/analysis-service";
import { ValidationError } from "@/lib/errors";

/**
 * POST /api/ai/analyze/thread (Phase 5 §57) — explicit, user-triggered
 * thread analysis. Tests inject the deterministic mock provider slug.
 */
const BodySchema = z.object({
  threadId: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw ValidationError("JSON body is required.");
    const input = BodySchema.safeParse({ threadId: body.threadId });
    if (!input.success) throw ValidationError("threadId is required.");

    // Provider selection: header override exists purely for DETERMINISTIC TEST
    // runs (never honored in production — registry guards this).
    const providerOverride = request.headers.get("x-ai-provider-override");
    const run = await analyzeThread({
      threadId: input.data.threadId,
      userId: Number(session.sub),
      ctx: {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      providerOverrideSlug: providerOverride ?? undefined,
    });

    return NextResponse.json({
      success: true,
      extractionId: run.extractionId,
      status: run.status,
      provider: run.provider,
      schemaVersion: run.schemaVersion,
      promptVersion: run.promptVersion,
      inputContextHash: run.inputContextHash,
      reductions: run.reductions,
      warnings: run.warnings,
      structured: run.structured,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
