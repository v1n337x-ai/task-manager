import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { parsePstSubjects } from "@/lib/services/pst-import-service";

/** POST /api/emails/pst/[jobId]/parse — mount via Outlook COM, list DISTINCT subject lines. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { jobId: raw } = await params;
    const jobId = Number(raw);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "jobId must be a positive integer.", details: null } }, { status: 422 });
    }
    const result = await parsePstSubjects(jobId, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
