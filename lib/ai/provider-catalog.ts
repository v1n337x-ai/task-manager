/**
 * AI provider metadata (Phase 2.1) — Settings-facing catalog, independent of
 * the run-time analysis ports (lib/ai/provider-registry.ts, Phase 5).
 * "opencode" has no implemented contract in this build (§6: no invented
 * endpoint/auth), so the connection test raises a truthful UNAVAILABLE state.
 */
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
    contractAvailable: false,
    contractNote: "No OpenCode API endpoint/model/authentication contract is available in this project yet.",
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
 * §2.1.15 — connection test NEVER fakes success without a contract.
 * The unwrapped test path stays deterministic: parse → (no contract) → UNAVAILABLE.
 */
export async function testProviderConnection(slug: string, _apiKey: string): Promise<ProviderTestResult> {
  const provider = CATALOG[slug];
  if (!provider) throw new UnknownProviderError(slug);
  if (!provider.contractAvailable) {
    return {
      status: "UNAVAILABLE",
      message: `Connection test unavailable until the ${provider.label} provider endpoint/configuration is supplied. The API key is stored safely and will be used when the contract is added.`,
    };
  }
  return { status: "UNAVAILABLE", message: `A contract was declared for ${provider.label} but no adapter is installed yet.` };
}

export function assertValidProvider(slug: string): void {
  if (!isValidProvider(slug)) throw new UnknownProviderError(slug);
}
