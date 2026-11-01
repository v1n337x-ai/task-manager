import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { generateDashboardReport, validateSeverity } from "@/lib/services/reporting/report-service";

/** GET /api/reports/snapshot (Phase 7 §5) — the shared report DTO for all surfaces. */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const filters: { applicationId?: number; severity?: "critical" | "high" | "medium" | "low" | "info"; statusValue?: string; iterationNumber?: number } = {};
    const appId = url.searchParams.get("applicationId");
    if (appId && Number(appId) > 0) filters.applicationId = Number(appId);
    const sev = url.searchParams.get("severity");
    if (sev) filters.severity = validateSeverity(sev);
    const st = url.searchParams.get("status");
    if (st) filters.statusValue = st;
    const iter = url.searchParams.get("iteration");
    if (iter && Number(iter) > 0) filters.iterationNumber = Number(iter);

    return NextResponse.json(await generateDashboardReport(filters));
  } catch (error) {
    return toErrorResponse(error);
  }
}
