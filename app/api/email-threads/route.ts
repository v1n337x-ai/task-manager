import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { createThread } from "@/lib/services/email-foundation-service";

/** Email threads seam (brief sections 27-28). Reconstruction logic = Phase 6. */
const BodySchema = z.object({
  applicationId: z.number().int().positive().nullable().optional(),
  subject: z.string().trim().min(3).max(500),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const input = BodySchema.parse(await request.json());
    const thread = await createThread(
      { applicationId: input.applicationId ?? null, subject: input.subject },
      Number(session.sub),
    );
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
