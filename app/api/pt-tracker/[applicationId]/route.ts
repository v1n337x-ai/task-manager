import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { getApplicationTracker } from "@/lib/services/tracker-service";
import { ValidationError } from "@/lib/errors";

/** GET /api/pt-tracker/[applicationId] (§49) — full detail payload. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ applicationId: string }> }) {
  try {
    await requireSessionH(request);
    const { applicationId } = await params;
    const id = Number(applicationId);
    if (!Number.isInteger(id) || id <= 0) throw ValidationError("Invalid application id.");
    return NextResponse.json(await getApplicationTracker(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
