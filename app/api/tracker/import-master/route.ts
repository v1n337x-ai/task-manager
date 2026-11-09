import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { getUserById } from "@/lib/services/user-service";
import { AppError, ValidationError } from "@/lib/errors";
import { importMasterTrackerWorkbook } from "@/lib/services/master-tracker-import-service";

/**
 * POST /api/tracker/import-master (Phase M2) — import the user's master
 * multi-app tracker workbook ("PT Tracker 26-27.xlsx", 'VAPT tracker' sheet).
 * SUPERUSER-only, multipart/form-data with a `file` field.
 * countsMode: "placeholder_findings" (default; aggregate counts become clearly
 * labeled placeholder findings) | "skip_counts" (metadata only).
 */
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const user = await getUserById(Number(session.sub));
    if (!user?.isSuperuser) throw new AppError("FORBIDDEN", 403, "Master tracker import is restricted to the platform admin.");

    const form = await request.formData().catch(() => null);
    if (!form) throw ValidationError("multipart/form-data body with a 'file' field is required.");
    const file = form.get("file");
    if (!(file instanceof File)) throw ValidationError("Upload field 'file' (xlsx workbook) is required.");
    if (file.size > MAX_BYTES) throw ValidationError("The workbook exceeds the 15 MB import limit.");
    const countsModeParam = String(form.get("countsMode") ?? "placeholder_findings");
    const countsMode = countsModeParam === "skip_counts" ? "skip_counts" as const : "placeholder_findings" as const;

    const fileContent = Buffer.from(await file.arrayBuffer());
    const result = await importMasterTrackerWorkbook(
      { fileContent, options: { fileName: file.name || "master-tracker.xlsx", countsMode } },
      Number(session.sub),
      {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
