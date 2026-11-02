import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { listApplicationReports, uploadApplicationReport } from "@/lib/services/reporting/pdf-report-service";

/**
 * GET  /api/applications/[id]/reports — report PDFs for the app.
 * POST /api/applications/[id]/reports — multipart PDF upload
 * (field `file`, optional `iterationId`). Auth + CSRF + magic bytes; the
 * client-declared MIME/name is never trusted.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionH(request);
    const { id: idRaw } = await params;
    const applicationId = Number(idRaw);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "applicationId must be a positive integer.", details: null } }, { status: 422 });
    }
    return NextResponse.json({ reports: await listApplicationReports(applicationId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id: applicationIdRaw } = await params;
    const applicationId = Number(applicationIdRaw);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "applicationId must be a positive integer.", details: null } }, { status: 422 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Send the PDF as multipart/form-data (field `file`).", details: null } }, { status: 422 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "No file uploaded (field `file`).", details: null } }, { status: 422 });
    }
    const iterationRaw = form.get("iterationId");
    const iterationId = typeof iterationRaw === "string" && iterationRaw !== "" && iterationRaw !== "null" ? Number(iterationRaw) : null;
    if (iterationId !== null && (!Number.isInteger(iterationId) || iterationId <= 0)) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "iterationId must be a positive integer or empty.", details: null } }, { status: 422 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const report = await uploadApplicationReport({
      applicationId,
      iterationId,
      filename: file.name,
      content: buffer,
      userId: Number(session.sub),
      ctx: {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });
    return NextResponse.json({ success: true, report });
  } catch (error) {
    return toErrorResponse(error);
  }
}
