import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { exportPptReport } from "@/lib/services/reporting/ppt-export-service";
import { validateSeverity } from "@/lib/services/reporting/report-service";

/**
 * POST /api/reports/ppt (Phase 7 §30) — live PPT generation from the shared
 * report snapshot; auth + CSRF + audit + export job.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const filters: { applicationId?: number; severity?: "critical" | "high" | "medium" | "low" | "info"; statusValue?: string; iterationNumber?: number } = {};
    if (typeof body?.applicationId === "number" && body.applicationId > 0) filters.applicationId = body.applicationId;
    if (typeof body?.severity === "string") filters.severity = validateSeverity(body.severity);
    if (typeof body?.statusValue === "string") filters.statusValue = body.statusValue;
    if (typeof body?.iterationNumber === "number") filters.iterationNumber = body.iterationNumber;

    const result = await exportPptReport({
      userId: Number(session.sub),
      filters,
      ctx: {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`,
        "X-Export-Job": String(result.jobId),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
