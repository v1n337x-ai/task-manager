import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { runConnectionTest } from "@/lib/services/ai-config-service";
import { TestAiConfigSchema } from "@/lib/validation/schemas";
import { ValidationError } from "@/lib/errors";

/**
 * POST /api/settings/ai/test (Phase 2.1 §14): server-side connection test.
 * Decrypts the stored key, calls the provider abstraction, stores the honest
 * result, and returns the SAFE DTO — the API key never leaves the server.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ValidationError("Malformed JSON body.");
    }
    const input = TestAiConfigSchema.parse(body);
    const result = await runConnectionTest(input.provider, Number(session.sub), {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
