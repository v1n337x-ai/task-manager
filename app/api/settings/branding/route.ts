import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { recordAudit } from "@/lib/audit";
import { getBrandingColors, setBrandingColors, validatePrimaryColor, validateSecondaryColor } from "@/lib/services/branding-service";
import { AppError } from "@/lib/errors";

/** GET /api/settings/branding — current UI/Excel primary and secondary colors. */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    return NextResponse.json({ colors: await getBrandingColors() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** PUT /api/settings/branding — update the UI/Excel theme colors. */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = (await request.json().catch(() => null)) as { primary?: unknown; secondary?: unknown } | null;
    try {
      const colors = await setBrandingColors({
        primary: validatePrimaryColor(body?.primary),
        secondary: validateSecondaryColor(body?.secondary),
      });
      await recordAudit({
        action: "settings.branding_updated",
        entityType: "BrandingSettings",
        newValue: JSON.stringify(colors),
        source: "HUMAN",
        actorUserId: Number(session.sub),
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      return NextResponse.json({ colors });
    } catch {
      throw new AppError("VALIDATION_ERROR", 422, "Task Manager theme only: primary must be an orange hex code and secondary must be a violet hex code.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
