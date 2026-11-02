import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { deleteApplicationReport, readApplicationReportBytes } from "@/lib/services/reporting/pdf-report-service";
import { getUserById } from "@/lib/services/user-service";

/**
 * GET    /api/app-reports/[reportId] — stream the ORIGINAL stored bytes.
 * DELETE /api/app-reports/[reportId] — superuser-only, audited.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { reportId: raw } = await params;
    const reportId = Number(raw);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "reportId must be a positive integer.", details: null } }, { status: 422 });
    }
    const { buffer, fileName } = await readApplicationReportBytes(reportId, {
      userId: Number(session.sub),
      ctx: {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });
    // Filenames carry only sanitized characters; no escaped bytes needed.
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName.replace(/["\\]/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const session = await requireSessionH(request);
    const user = await getUserById(Number(session.sub));
    if (!user) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Session user no longer exists.", details: null } }, { status: 401 });
    }
    const { reportId: raw } = await params;
    const reportId = Number(raw);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "reportId must be a positive integer.", details: null } }, { status: 422 });
    }
    await deleteApplicationReport(reportId, {
      userId: user.id,
      isSuperuser: user.isSuperuser,
      ctx: {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
