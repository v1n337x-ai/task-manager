/**
 * AI provider abstraction (Phase 2.1 brief §15-16).
 * Providers register a stable slug + label. A provider exposes a connection
 * test ONLY when its real integration contract (endpoint/model/auth) is known
 * in this project. We never invent endpoints — an unknown contract yields an
 * honest "unavailable" result instead of a fake "Connected".
 */
export interface ProviderTestResult {
  status: "PASSED" | "FAILED" | "UNAVAILABLE";
  message: string;
}

export interface AiProviderMetadata {
  slug: string;
  label: string;
  /** True when a real API contract is implemented in this codebase. */
  contractAvailable: boolean;
  /** Where the contract would live once supplied (documentation hint only). */
  contractNote: string;
}

export type ProviderConnector = (apiKey: string) => Promise<ProviderTestResult>;

const REGISTRY: {
  metadata: AiProviderMetadata;
  connector?: ProviderConnector;
}[] = [
  {
    metadata: {
      slug: "opencode",
      label: "OpenCode",
      contractAvailable: false,
      contractNote:
        "No OpenCode API endpoint/model/authentication contract is available in this project yet.",
    },
  },
];

export class UnknownProviderError extends Error {
  constructor(slug: string) {
    super(`Unknown AI provider: ${slug}`);
    this.name = "UnknownProviderError";
  }
}

export function listProviders(): AiProviderMetadata[] {
  return REGISTRY.map((r) => r.metadata);
}

export function providerLabel(slug: string): string {
  return REGISTRY.find((r) => r.metadata.slug === slug)?.metadata.label ?? slug;
}

export function isValidProvider(slug: string): boolean {
  return REGISTRY.some((r) => r.metadata.slug === slug);
}

/**
 * Server-side connection test (Phase 2.1 §14).
 * Never fabricates success: unknown contract ⇒ UNAVAILABLE with the honest message.
 */
export async function testProviderConnection(slug: string, apiKey: string): Promise<ProviderTestResult> {
  const entry = REGISTRY.find((r) => r.metadata.slug === slug);
  if (!entry) throw new UnknownProviderError(slug);
  if (!entry.connector) {
    return {
      status: "UNAVAILABLE",
      message: `Connection test unavailable until the ${entry.metadata.label} provider endpoint/configuration is supplied. The API key is stored safely and will be used when the contract is added.`,
    };
  }
  try {
    return await entry.connector(apiKey);
  } catch (error) {
    // Provider errors must never echo the key.
    return { status: "FAILED", message: `Provider test failed: ${String(error).slice(0, 200)}` };
  }
}
