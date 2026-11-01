import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { getEnv } from "@/lib/env";
import { sha256Buffer } from "@/lib/services/job-foundation-service";
import { validateImport } from "@/lib/excel/import-service";
import { getAiConfigSafe } from "@/lib/services/ai-config-service";

void getAiConfigSafe;
/**
 * POST /api/imports/excel (§49/§25) — multipart upload → validation + preview.
 * NO business writes; the ImportJob stores the normalized preview in `ready`.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const env = getEnv();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Send the workbook as multipart/form-data with a `file` field." } },
        { status: 422 },
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Field `file` (xlsx) is required." } },
        { status: 422 },
      );
    }
    // Never trust filename/MIME/extension (§48): sniff the bytes via ExcelJS during validation.
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "File exceeds 20 MB." } }, { status: 422 });
    }

    const options = {
      createMissingApplications: form.get("createMissingApplications") === "true",
      force: form.get("force") === "true" || env.NODE_ENV === "development" && false,
    };
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await validateImport({
      filename: file.name,
      mimeType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: buffer,
      userId: Number(session.sub),
      options,
      ctx: { ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined, userAgent: request.headers.get("user-agent") ?? undefined },
      createSha256Fn: sha256Buffer,
    });

    const payload: Record<string, unknown> = { jobId: result.jobId, preview: result.preview };
    if (result.alreadyImported) payload.alreadyImported = true;
    payload.exceptions = result.validation.exceptions;
    return NextResponse.json({ success: result.validation.ok, ...payload }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
