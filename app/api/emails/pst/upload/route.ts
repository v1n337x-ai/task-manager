import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { uploadPst, uploadPstByPath } from "@/lib/services/pst-import-service";

/**
 * POST /api/emails/pst/upload
 * Content-Type application/json { sourcePath, applicationId }:
 *   references a .pst ALREADY ON DISK that a running Outlook has mounted
 *   (byte-locked, so bytes are not copied — the COM worker mounts the store
 *   from that exact path). Verbatim preservation stays with the user's file.
 * multipart/form-data:
 *   uploads the .pst bytes normally (stored under storage/pst).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const ctype = request.headers.get("content-type") ?? "";
    const ctx = {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    };

    if (ctype.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { sourcePath?: string; applicationId?: number } | null;
      if (!body?.sourcePath) {
        return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "sourcePath is required for path-based .pst ingestion.", details: null } }, { status: 422 });
      }
      const result = await uploadPstByPath(
        { sourcePath: body.sourcePath, applicationId: typeof body.applicationId === "number" ? body.applicationId : undefined, userId: Number(session.sub), ctx },
      );
      return NextResponse.json({ success: true, result });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Send the .pst as multipart/form-data (field `file`).", details: null } }, { status: 422 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "No .pst uploaded (field `file`).", details: null } }, { status: 422 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const declaredRaw = form.get("applicationId");
    const declaredApplicationId = typeof declaredRaw === "string" && declaredRaw !== "" ? Number(declaredRaw) : undefined;
    const result = await uploadPst({
      filename: file.name,
      content: buffer,
      userId: Number(session.sub),
      applicationId: declaredApplicationId,
      ctx,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
