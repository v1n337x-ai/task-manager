import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { recordAudit } from "@/lib/audit";
import { getTemplateStatus, removeTemplate, saveTemplate } from "@/lib/services/ppt-template-service";
import { AppError } from "@/lib/errors";

/** GET /api/settings/ppt-template — current uploaded PPT template summary. */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    return NextResponse.json({ template: await getTemplateStatus() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/settings/ppt-template — upload and analyze a PPTX template. */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const form = await request.formData();
    const file = form.get("template");
    if (!file || typeof file === "string") {
      throw new AppError("VALIDATION_ERROR", 422, "Choose a .pptx file to upload.");
    }

    const name = file.name;
    const buffer = Buffer.from(await file.arrayBuffer());
    const analysis = await saveTemplate(buffer, name);
    await recordAudit({
      action: "ppt_template.uploaded",
      entityType: "ReportTemplate",
      newValue: JSON.stringify({
        filename: name,
        sha256: analysis.sha256,
        slideCount: analysis.slideCount,
        bytes: analysis.storedBytes,
      }),
      source: "HUMAN",
      actorUserId: Number(session.sub),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ template: analysis });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** DELETE /api/settings/ppt-template — remove the uploaded PPT template. */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    await removeTemplate();
    await recordAudit({
      action: "ppt_template.deleted",
      entityType: "ReportTemplate",
      source: "HUMAN",
      actorUserId: Number(session.sub),
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ template: null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
