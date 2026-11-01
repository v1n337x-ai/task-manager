import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { listExportJobs } from "@/lib/services/job-foundation-service";

/**
 * Export foundations (brief sections 36/51). Excel export = Phase 3;
 * PowerPoint report = Phase 4/5. POST responds 501 — never fake-complete.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    return NextResponse.json({ jobs: await listExportJobs(20) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSessionH(request);
    return NextResponse.json(
      {
        error: {
          code: "NOT_IMPLEMENTED",
          message: "Excel export activates in Phase 3; PowerPoint composition in Phase 4/5.",
        },
      },
      { status: 501, headers: { "Allow": "GET" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
