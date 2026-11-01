import { NextResponse } from "next/server";
import { CreateApplicationSchema } from "@/lib/validation/schemas";
import { listApplications, createApplication } from "@/lib/services/application-service";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import type { NextRequest } from "next/server";
import { ValidationError } from "@/lib/errors";

/** GET /api/applications — list registry (server-side auth check, brief §49). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const apps = await listApplications();
    return NextResponse.json({ applications: apps });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/applications — create application (validated + audited). */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      throw ValidationError("Malformed JSON body.");
    }
    const input = CreateApplicationSchema.parse(body);
    const app = await createApplication(input, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ application: app }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
