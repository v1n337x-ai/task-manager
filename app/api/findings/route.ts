import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { createFinding, setFindingIterationState, listFindings } from "@/lib/services/finding-service";
import { CreateFindingSchema, SetFindingIterationStateSchema } from "@/lib/validation/schemas";
import { ValidationError } from "@/lib/errors";

/** GET /api/findings?applicationId= — findings + iteration states (Phase 2 seam). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const applicationId = Number(url.searchParams.get("applicationId"));
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      throw ValidationError("applicationId is required.");
    }
    return NextResponse.json({ findings: await listFindings(applicationId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/findings — create a finding (stable identity, F-### code). */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const input = CreateFindingSchema.parse(await request.json());
    const finding = await createFinding(input, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    });
    return NextResponse.json({ finding }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** PUT /api/findings — record an iteration state (append-only history). */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const input = SetFindingIterationStateSchema.parse(await request.json());
    const state = await setFindingIterationState(input, Number(session.sub), { source: "HUMAN" });
    return NextResponse.json({ state }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
