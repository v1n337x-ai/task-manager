/**
 * AI provider metadata (Phase 2.1 → Phase 5.1) — Settings-facing catalog,
 * independent of the run-time analysis ports (lib/ai/provider-registry.ts).
 * "opencode" carries the REAL, live-verified OpenCode v2 HTTP contract:
 * the connection test performs an actual GET /api/info against the server
 * (OPENCODE_SERVER_URL) using HTTP basic auth (user "opencode", credential =
 * the stored API key). It NEVER fakes success (§2.1.15).
 */
import { getOpenCodeBaseUrl, pingOpenCode } from "./opencode";

export interface AiProviderMetadata {
  slug: string;
  label: string;
  /** True when a real API contract is implemented in this codebase. */
  contractAvailable: boolean;
  contractNote: string;
}

export interface ProviderTestResult {
  status: "PASSED" | "FAILED" | "UNAVAILABLE";
  message: string;
}

export class UnknownProviderError extends Error {
  constructor(slug: string) {
    super(`Unknown AI provider: ${slug}`);
    this.name = "UnknownProviderError";
  }
}

const CATALOG: Record<string, AiProviderMetadata> = {
  opencode: {
    slug: "opencode",
    label: "OpenCode",
    contractAvailable: true,
    contractNote:
      "Real OpenCode v2 server contract is implemented: OPENCODE_SERVER_URL must point at `opencode serve` / the background service, and the stored credential is used as the basic-auth password.",
  },
};

export function listProviders(): AiProviderMetadata[] {
  return Object.values(CATALOG);
}

export function providerLabel(slug: string): string {
  return CATALOG[slug]?.label ?? slug;
}

export function isValidProvider(slug: string): boolean {
  return slug in CATALOG;
}

/**
 * §2.1.15 — connection test NEVER fakes success. When OPENCODE_SERVER_URL is
 * not configured the test is honestly UNAVAILABLE; when configured it makes a
 * real GET /api/info call and reports the truthful outcome.
 */
export async function testProviderConnection(slug: string, apiKey: string): Promise<ProviderTestResult> {
  const provider = CATALOG[slug];
  if (!provider) throw new UnknownProviderError(slug);
  if (slug !== "opencode") {
    return { status: "UNAVAILABLE", message: `No connection test is implemented for ${provider.label} yet.` };
  }

  let baseUrl: string | null;
  try {
    baseUrl = getOpenCodeBaseUrl();
  } catch (error) {
    return { status: "UNAVAILABLE", message: `OpenCode configuration error: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!baseUrl) {
    return {
      status: "UNAVAILABLE",
      message:
        "Connection test unavailable until the OpenCode provider endpoint/configuration is supplied. Set OPENCODE_SERVER_URL (the server location printed by `opencode service status` or `opencode serve`). The API key is stored safely and will be used as the server credential.",
    };
  }
  if (!apiKey.trim()) {
    return { status: "UNAVAILABLE", message: "No OpenCode credential is stored. Save one under Settings → AI first." };
  }

  const ping = await pingOpenCode({ baseUrl, credential: apiKey, timeoutMs: 10_000 });
  if (ping.ok) {
    return {
      status: "PASSED",
      message: `Connected to OpenCode server at ${baseUrl}${ping.version ? ` (v${ping.version})` : ""}.`,
    };
  }
  if (ping.kind === "auth") {
    return { status: "FAILED", message: `${ping.message} Verify the stored credential (mint one with \`opencode pair\`).` };
  }
  return { status: "UNAVAILABLE", message: ping.message };
}

export function assertValidProvider(slug: string): void {
  if (!isValidProvider(slug)) throw new UnknownProviderError(slug);
}
