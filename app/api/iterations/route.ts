import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { createIteration, ensureDefaultEngagement, listIterations } from "@/lib/services/engagement-service";
import { CreateIterationSchema } from "@/lib/validation/schemas";
import { ValidationError } from "@/lib/errors";

/**
 * Phase 3 endpoints (Â§49): the complete tracker UI activation.
 * Iterations POST accepts EITHER engagementId OR applicationId (the default
 * engagement container is created audited-only when missing).
 */
const ListSchema = z.object({ engagementId: z.coerce.number().int().positive() });

export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const parsed = ListSchema.safeParse({ engagementId: url.searchParams.get("engagementId") });
    if (!parsed.success) throw ValidationError("engagementId is required.");
    return NextResponse.json({ iterations: await listIterations(parsed.data.engagementId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = (await request.json()) as Record<string, unknown>;
    let engagementId = typeof body.engagementId === "number" ? body.engagementId : undefined;
    const applicationId = typeof body.applicationId === "number" ? body.applicationId : undefined;
    if (!engagementId && applicationId) {
      engagementId = (await ensureDefaultEngagement(applicationId, Number(session.sub))).id;
    }
    if (!engagementId) throw ValidationError("engagementId or applicationId is required.");

    const input = CreateIterationSchema.parse({ ...body, engagementId });
    const iteration = await createIteration(input, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ iteration }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}


