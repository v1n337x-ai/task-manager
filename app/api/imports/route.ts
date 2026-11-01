import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { listImportJobs } from "@/lib/services/job-foundation-service";

/** GET /api/imports (§49) — import job history (§30). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    return NextResponse.json({ jobs: await listImportJobs(20) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
