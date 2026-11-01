import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { confirmImport } from "@/lib/excel/import-service";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";

/**
 * POST /api/imports/excel/confirm (§25/§51) — transactional persistence of a
 * validated preview. The user explicitly confirmed in the UI dialog.
 */
const ConfirmSchema = z.object({ jobId: z.number().int().positive() });

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = await request.json().catch(() => null);
    const input = ConfirmSchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "jobId is required." } },
        { status: 422 },
      );
    }
    const job = await prisma.importJob.findUnique({ where: { id: input.data.jobId }, select: { id: true } });
    if (!job) throw NotFoundError("Import job");
    const result = await confirmImport(job.id, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
