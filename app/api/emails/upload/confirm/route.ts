import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { confirmEmlUpload } from "@/lib/eml/email-import-service";

const BodySchema = z.object({
  jobIds: z.array(z.number().int().positive()).min(1).max(50),
  force: z.boolean().optional(),
});

/** POST /api/emails/upload/confirm (Phase 4 §4) — persist confirmed parsed emails. */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = await request.json().catch(() => null);
    const input = BodySchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "jobIds (1..50 integers) is required." } },
        { status: 422 },
      );
    }

    const ctx = {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    };

    const results: Array<Record<string, unknown>> = [];
    for (const jobId of input.data.jobIds) {
      try {
        const result = await confirmEmlUpload({
          jobId,
          userId: Number(session.sub),
          force: input.data.force ?? false,
          ctx,
        });
        results.push({ ok: true, jobId, ...result });
      } catch (error) {
        results.push({ ok: false, jobId, error: String((error as Error).message ?? error).slice(0, 400) });
      }
    }

    return NextResponse.json({ success: results.every((r) => r.ok), results });
  } catch (error) {
    return toErrorResponse(error);
  }
}
