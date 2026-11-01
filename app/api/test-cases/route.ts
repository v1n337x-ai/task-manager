import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { createTestCase, setTestCaseIterationState, listTestCases } from "@/lib/services/test-case-service";
import { CreateTestCaseSchema, SetTestCaseIterationStateSchema } from "@/lib/validation/schemas";
import { ValidationError } from "@/lib/errors";

/** Phase 2 seams for test cases (brief sections 20-22); full UI in Phase 3. */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const applicationId = Number(url.searchParams.get("applicationId"));
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      throw ValidationError("applicationId is required.");
    }
    return NextResponse.json({ testCases: await listTestCases(applicationId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const input = CreateTestCaseSchema.parse(await request.json());
    const testCase = await createTestCase(input, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    });
    return NextResponse.json({ testCase }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const input = SetTestCaseIterationStateSchema.parse(await request.json());
    const row = await setTestCaseIterationState(input, Number(session.sub), { source: "HUMAN" });
    return NextResponse.json({ testCaseIteration: row }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
