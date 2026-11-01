import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { getAiConfigSafe, saveAiConfig, clearAiApiKey } from "@/lib/services/ai-config-service";
import { SaveAiConfigSchema } from "@/lib/validation/schemas";
import { ValidationError } from "@/lib/errors";
import { listProviders } from "@/lib/ai/provider-registry";

/**
 * AI configuration endpoints (Phase 2.1 §12-13):
 * GET  → safe DTO only (never apiKey/encryptedApiKey/decryptedApiKey)
 * POST → SAVE (encrypt + upsert) or CLEAR_KEY (explicit, confirmed in UI)
 */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const providerParam = url.searchParams.get("provider");
    const provider = providerParam === "opencode" ? "opencode" : "opencode";
    const safe = await getAiConfigSafe(provider);
    return NextResponse.json({ ...safe, providers: listProviders() });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ValidationError("Malformed JSON body.");
    }
    const input = SaveAiConfigSchema.parse(body);
    const ctx = {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    };

    if (input.action === "CLEAR_KEY") {
      const safe = await clearAiApiKey(input.provider, Number(session.sub), ctx);
      return NextResponse.json({ ...safe, cleared: true });
    }

    const apiKey = typeof input.apiKey === "string" && input.apiKey.length > 0 ? input.apiKey : undefined;
    const safe = await saveAiConfig(
      { provider: input.provider, enabled: input.enabled, apiKey },
      Number(session.sub),
      ctx,
    );
    return NextResponse.json(safe, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
