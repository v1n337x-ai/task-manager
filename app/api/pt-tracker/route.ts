import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { listTrackerApps, summarize } from "@/lib/services/tracker-service";
import { getEnv } from "@/lib/env";

/** GET /api/pt-tracker (§49) — dense application rows + live totals (§56). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? undefined;
    const type = url.searchParams.get("type") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const scope = url.searchParams.get("scope") ?? undefined;
    const severity = url.searchParams.get("severity") ?? undefined;
    const fixedStateParam = url.searchParams.get("fixedState") ?? undefined;
    const iterationNumber = url.searchParams.get("iteration");

    const fixedState = ["fixed", "not_fixed", "new", "pending"].includes(fixedStateParam ?? "")
      ? (fixedStateParam as "fixed" | "not_fixed" | "new" | "pending")
      : undefined;
    const rows = await listTrackerApps({
      q: q || undefined,
      type: type || undefined,
      status: status || undefined,
      scope: scope || undefined,
      severity: severity || undefined,
      fixedState,
      iterationNumber: iterationNumber ? Number(iterationNumber) : undefined,
    });
    if (getEnv().NODE_ENV === "development") void "debug-hint";
    return NextResponse.json({ applications: rows, totals: summarize(rows) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
