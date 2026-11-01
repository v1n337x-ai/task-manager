import { NextResponse, type NextRequest } from "next/server";
import { listAll, toggleValue } from "@/lib/services/master-data-service";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { z } from "zod";

/** GET /api/master-data — controlled vocabularies (brief sections 14/50). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    return NextResponse.json({ masterValues: await listAll() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/master-data — activate/deactivate a controlled value (audited). */
const ToggleSchema = z.object({ id: z.number().int().positive(), isActive: z.boolean() });

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = ToggleSchema.parse(await request.json());
    await toggleValue(body.id, body.isActive, Number(session.sub));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
