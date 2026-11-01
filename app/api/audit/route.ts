import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { listAudit } from "@/lib/services/audit-query-service";

/** GET /api/audit — recent audit entries (brief section 35). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const take = Math.min(Number(url.searchParams.get("take") ?? 50), 200);
    const source = url.searchParams.get("source") ?? undefined;
    const rows = await listAudit({ take, source });
    return NextResponse.json({ entries: rows });
  } catch (error) {
    return toErrorResponse(error);
  }
}
