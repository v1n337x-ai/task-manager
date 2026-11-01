import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { listImportJobs } from "@/lib/services/job-foundation-service";

/**
 * Import foundations (brief sections 36/51). Phase 2 lists the real job table;
 * the processor itself is Phase 3 — POST answers 501 Accepted-Not-Ready so no
 * fake job state is ever created.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    return NextResponse.json({ jobs: await listImportJobs(20) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSessionH(request);
    // Validate the roundtrip contract input exists even though processing is Phase 3.
    void z.object({ filename: z.string().min(1).max(300) }).safeParse(await request.json().catch(() => null));
    return NextResponse.json(
      {
        error: {
          code: "NOT_IMPLEMENTED",
          message: "Excel import processing activates in Phase 3. The job registry exists today.",
        },
      },
      { status: 501, headers: { "Allow": "GET" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
