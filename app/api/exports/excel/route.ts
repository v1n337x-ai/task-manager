import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { exportTrackerWorkbook } from "@/lib/excel/export-service";
import { listExportJobs } from "@/lib/services/job-foundation-service";

/** POST /api/exports/excel (§31/§49) — template-preserving xlsx download. */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const result = await exportTrackerWorkbook(Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`,
        "X-Export-Job": String(result.jobId),
        "X-Export-Rows": String(result.rows),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET /api/exports/excel — export job history. */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    return NextResponse.json({ jobs: await listExportJobs(20) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
