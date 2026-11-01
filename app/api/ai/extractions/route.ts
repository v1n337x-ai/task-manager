import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/api-helpers";
import { requireSessionH } from "@/lib/api-helpers";
import type { NextRequest } from "next/server";
import { listExtractions } from "@/lib/services/ai-foundation-service";
import { createExtraction, addEvidence, recordApprovalDecision } from "@/lib/services/ai-foundation-service";
import { CreateExtractionSchema, AddEvidenceSchema, ApprovalDecisionSchema } from "@/lib/validation/schemas";

/**
 * AI extraction foundations (brief sections 32-34/61): endpoints exist and are
 * authenticated/validated; the AI agent is NOT wired until Phase 5.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const statusValue = url.searchParams.get("status") ?? undefined;
    return NextResponse.json({ extractions: await listExtractions(statusValue) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = await request.json();
    if (body && typeof body === "object" && "decision" in body) {
      const input = ApprovalDecisionSchema.parse(body);
      await recordApprovalDecision(input, Number(session.sub), { ip: request.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined });
      return NextResponse.json({ ok: true });
    }
    if (body && typeof body === "object" && "extractionId" in body && "sourceType" in body) {
      const input = AddEvidenceSchema.parse(body);
      const evidence = await addEvidence(input, null);
      return NextResponse.json({ evidence }, { status: 201 });
    }
    const input = CreateExtractionSchema.parse(body);
    const extraction = await createExtraction(input, null, "SYSTEM");
    return NextResponse.json({ extraction }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
