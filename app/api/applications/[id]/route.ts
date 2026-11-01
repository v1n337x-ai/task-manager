import { NextResponse, type NextRequest } from "next/server";
import { UpdateApplicationSchema } from "@/lib/validation/schemas";
import { getApplication, updateApplication, deactivateApplication } from "@/lib/services/application-service";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { ValidationError } from "@/lib/errors";

/** GET/PATCH/DELETE /api/applications/[id] (brief section 50). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionH(request);
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) throw ValidationError("Invalid application id.");
    return NextResponse.json({ application: await getApplication(numericId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) throw ValidationError("Invalid application id.");
    const patch = UpdateApplicationSchema.parse(await request.json());
    const app = await updateApplication(numericId, patch, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ application: app });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** DELETE is a soft deactivation (history preserved, brief section 60). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) throw ValidationError("Invalid application id.");
    await deactivateApplication(numericId, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
