/**
 * AI provider ports (Phase 5 §5-§6). The application never hardcodes vendor
 * specifics. Each provider implements `analyze(context)` returning a
 * STRUCTURED AI_EXTRACTION_V1 response (validated by the caller with Zod).
 *
 * §6 — no invented provider contracts: OpenCode's real endpoint/auth protocol
 * is not available in this project yet, so its port returns an honest
 * UNAVAILABLE failure. A "mock" provider exists for deterministic AUTOMATED
 * TESTS only (§79) and is registry-gated behind NODE_ENV != production.
 */
export interface AiAnalyzeContextInput {
  applicationName: string | null;
  applicationUrl: string | null;
  applicationAliases: string[];
  iterations: { number: number; name: string; type: string; status: string }[];
  existingFindings: { code: string; title: string; severity: string; status: string; testCase: string | null }[];
  existingTestCases: { code: string; title: string; state: string }[];
  subject: string | null;
  messages: {
    index: number; // deterministic context index (evidence refs)
    from: string;
    recipients: string[];
    sentAt: string | null;
    bodyText: string;
    participants: string[];
  }[];
}

export interface AiProviderAnalyzeResult {
  ok: boolean;
  structured: unknown; // validated as AI_EXTRACTION_V1 by the analysis service
  provider: string; // resolved slug
  modelRaw: string | null;
  warnings: string[];
}

export interface AiProviderPort {
  slug: string;
  modelRaw: string | null;
  /** Honest capability gate (§6): no invented endpoint → never claimed available. */
  contractAvailable: boolean;
  analyze(context: AiAnalyzeContextInput): Promise<AiProviderAnalyzeResult>;
}

export class ProviderUnavailableError extends Error {
  code = "PROVIDER_CONTRACT_UNAVAILABLE";
  constructor(slug: string) {
    super(`The configured provider "${slug}" has no implemented API contract in this build. AI analysis cannot run until the provider contract is supplied. The thread was NOT altered.`);
  }
}
