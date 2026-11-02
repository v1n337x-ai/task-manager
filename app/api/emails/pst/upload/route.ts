import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { uploadPst } from "@/lib/services/pst-import-service";

/** POST /api/emails/pst/upload — store a .pst verbatim (type pst_batch). */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Send the .pst as multipart/form-data (field `file` + `applicationId`).", details: null } }, { status: 422 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "No .pst uploaded (field `file`).", details: null } }, { status: 422 });
    }
    const sizeCheck = typeof file.size === "number" && file.size > 1024 * 1024 * 1024;
    if (sizeCheck) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "The .pst is over the 1 GB limit.", details: null } }, { status: 422 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadPst({
      filename: file.name,
      content: buffer,
      userId: Number(session.sub),
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
