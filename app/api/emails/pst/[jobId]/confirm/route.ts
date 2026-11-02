import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { confirmPstSelection } from "@/lib/services/pst-import-service";

/** POST /api/emails/pst/[jobId]/confirm — export+import selected subjects as .eml into the pipeline. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { jobId: raw } = await params;
    const jobId = Number(raw);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "jobId must be a positive integer.", details: null } }, { status: 422 });
    }
    const body = (await request.json().catch(() => null)) as { selectedKeys?: unknown; declaredApplicationId?: unknown } | null;
    if (!body || !Array.isArray(body.selectedKeys) || body.selectedKeys.length === 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Select at least one subject to import.", details: null } }, { status: 422 });
    }
    const selectedKeys = body.selectedKeys.filter((k): k is string => typeof k === "string" && k.length > 0);
    if (selectedKeys.length === 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "No valid subject keys in selection.", details: null } }, { status: 422 });
    }
    const declaredApplicationId = typeof body.declaredApplicationId === "number" && body.declaredApplicationId > 0 ? body.declaredApplicationId : undefined;
    void declaredApplicationId; // persisted on the job at upload time; confirm reads job.options
    const result = await confirmPstSelection(
      {
        jobId,
        selectedKeys,
        userId: Number(session.sub),
        ctx: {
          ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        },
      },
    );
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
