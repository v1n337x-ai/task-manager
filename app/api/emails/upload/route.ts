import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { validateEmlUpload } from "@/lib/eml/email-import-service";
import { maxEmlBytes } from "@/lib/eml/storage";
import { randomBytes } from "node:crypto";

/**
 * POST /api/emails/upload (Phase 4 §4-§10) — multipart batch of .eml files.
 * Per file: guards → parse → store original → preview persisted (status ready).
 * Nothing is written to email tables until the user confirms (§4).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "Send .eml files as multipart/form-data (field `files`)." } },
        { status: 422 },
      );
    }

    const declaredRaw = form.get("applicationId");
    const declaredApplicationId = typeof declaredRaw === "string" && declaredRaw !== "" ? Number(declaredRaw) : null;
    if (declaredApplicationId !== null && (!Number.isInteger(declaredApplicationId) || declaredApplicationId <= 0)) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "applicationId must be a positive integer or null." } },
        { status: 422 },
      );
    }

    const files = [...form.getAll("files")].filter((f): f is File => f instanceof File);
    const single = form.get("file");
    if (single instanceof File) files.push(single);
    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "No files uploaded (field `files`)." } },
        { status: 422 },
      );
    }

    const batchId = randomBytes(12).toString("hex");
    const maxBytes = maxEmlBytes();
    const results: Array<Record<string, unknown>> = [];

    for (const file of files) {
      try {
        if (file.size > maxBytes) {
          throw new Error(`exceeds MAX_EML_SIZE_MB (limit ${Math.round(maxBytes / 1048576)} MB)`);
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await validateEmlUpload({
          filename: file.name,
          content: buffer,
          userId: Number(session.sub),
          applicationId: declaredApplicationId,
          options: { batchId },
          ctx: {
            ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
            userAgent: request.headers.get("user-agent") ?? undefined,
          },
        });
        results.push({ ok: true, jobId: result.jobId, filename: result.preview.filename, duplicate: result.duplicate, duplicateOf: result.preview.duplicateOf ?? null, preview: result.preview });
      } catch (error) {
        results.push({ ok: false, filename: file.name, error: String((error as Error).message ?? error).slice(0, 400) });
      }
    }

    return NextResponse.json({
      success: results.every((r) => r.ok),
      batchId,
      declaredApplicationId,
      results,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
