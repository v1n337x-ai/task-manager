import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { confirmPstSelection } from "@/lib/services/pst-import-service";

const BodySchema = z.object({
  selectedKeys: z.array(z.string().min(1)).min(1, "Select at least one subject."),
  declaredApplicationId: z.number().int().positive().optional(),
});

/** POST /api/emails/pst/[jobId]/confirm — export+import selected subjects as .eml into the pipeline. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { jobId: raw } = await params;
    const jobId = Number(raw);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "jobId must be a positive integer.", details: null } }, { status: 422 });
    }
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: body.error.issues.map((i) => i.message).join("; "), details: null } }, { status: 422 });
    }
    const result = await confirmPstSelection(
      {
        jobId,
        selectedKeys: body.data.selectedKeys,
        userId: Number(session.sub),
        ctx: {
          ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        },
      },
    );
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
