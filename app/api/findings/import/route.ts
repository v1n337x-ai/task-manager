import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { importFindingList } from "@/lib/services/finding-import-service";

/**
 * POST /api/findings/import (user-requested pipeline completion) — multipart
 * upload of an analyst finding-list workbook (vapt.xlsx shape) scoped to one
 * application. Auth + CSRF; per-row truth report (created / skipped / warned).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Send the workbook as multipart/form-data (field `file` + `applicationId`).", details: null } }, { status: 422 });
    }
    const file = form.get("file");
    const applicationRaw = form.get("applicationId");
    const applicationId = typeof applicationRaw === "string" && applicationRaw !== "" ? Number(applicationRaw) : null;
    if (!(file instanceof File)) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "No workbook uploaded (field `file`).", details: null } }, { status: 422 });
    }
    if (applicationId === null || !Number.isInteger(applicationId) || applicationId <= 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "applicationId must be a positive integer.", details: null } }, { status: 422 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importFindingList({
      applicationId,
      content: buffer,
      actorUserId: Number(session.sub),
      ctx: {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
