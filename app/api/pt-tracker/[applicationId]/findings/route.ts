import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { getApplicationTracker } from "@/lib/services/tracker-service";
import { ValidationError } from "@/lib/errors";

/** GET /api/pt-tracker/[applicationId]/findings (§49) — findings summary only. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ applicationId: string }> }) {
  try {
    await requireSessionH(request);
    const { applicationId } = await params;
    const id = Number(applicationId);
    if (!Number.isInteger(id) || id <= 0) throw ValidationError("Invalid application id.");
    const detail = await getApplicationTracker(id);
    return NextResponse.json({ findings: detail.findings, totals: detail.totals, iterationsUsed: detail.iterations.map((i) => i.number) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
