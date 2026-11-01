import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";

/** GET /api/participants — email participants with effective role fields (§29/§30). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const rows = await prisma.emailParticipant.findMany({
      include: { roleRef: true, roleOverrideRef: true },
      orderBy: { emailAddress: "asc" },
      take: 200,
    });
    return NextResponse.json({
      participants: rows.map((p) => ({
        id: p.id,
        email: p.emailAddress,
        name: p.name,
        displayName: p.displayName,
        aiRole: p.roleRef.value,
        roleSource: p.roleSource,
        confidence: p.confidence,
        humanOverrideRole: p.roleOverrideRef?.value ?? null,
        effectiveRole: p.roleOverrideRef ? "human-override" : p.roleRef.value,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
