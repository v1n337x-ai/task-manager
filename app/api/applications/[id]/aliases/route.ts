import { NextResponse, type NextRequest } from "next/server";
import { AddAliasSchema } from "@/lib/validation/schemas";
import { addAlias, listAliases } from "@/lib/services/application-service";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { ValidationError } from "@/lib/errors";

/** GET/POST /api/applications/[id]/aliases (brief section 50). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionH(request);
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) throw ValidationError("Invalid application id.");
    return NextResponse.json({ aliases: await listAliases(numericId) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id } = await params;
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) throw ValidationError("Invalid application id.");

    const body = await request.json();
    const input = AddAliasSchema.parse({ ...body, applicationId: numericId });
    const alias = await addAlias(input, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ alias }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
