import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { createIteration, listIterations } from "@/lib/services/engagement-service";
import { CreateIterationSchema } from "@/lib/validation/schemas";
import { ValidationError } from "@/lib/errors";

/**
 * Phase 2 endpoints exist as the clean architecture seam (brief section 50); the
 * complete PT Tracker UI activates in Phase 3. Mutations here are already
 * functional, validated and audited so the foundation test (§59) can run.
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
    const input = CreateIterationSchema.parse(await request.json());
    const iteration = await createIteration(input, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    });
    return NextResponse.json({ iteration }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
