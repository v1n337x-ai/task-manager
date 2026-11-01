import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

/**
 * POST /api/imports/excel/validate (§49) — re-run validation on a stored,
 * previously validated job (idempotent; no business writes).
 */
const ValidateSchema = z.object({ jobId: z.number().int().positive() });

export async function POST(request: NextRequest) {
  try {
    await requireSessionH(request);
    const body = await request.json().catch(() => null);
    const input = ValidateSchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "jobId is required." } }, { status: 422 });
    }
    const job = await prisma.importJob.findUnique({ where: { id: input.data.jobId }, include: { statusRef: true } });
    if (!job) throw NotFoundError("Import job");
    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.statusRef.value,
      preview: job.summary,
      note: "Validation is stored from upload time; confirm proceeds from the same preview.",
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
