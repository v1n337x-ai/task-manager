/**
 * AI provider ports (Phase 5 §5-§6, updated Phase 5.1). The application never
 * hardcodes vendor specifics. Each provider implements `analyze(context)`
 * returning a STRUCTURED AI_EXTRACTION_V1 response (validated by the caller
 * with Zod).
 *
 * §6 — no invented provider contracts: the OpenCode port uses ONLY the real,
 * live-verified v2 server contract (lib/ai/opencode.ts) and stays honestly
 * unavailable when no server/credential configuration exists. A "mock"
 * provider exists for deterministic AUTOMATED TESTS only (§79) and is
 * registry-gated behind NODE_ENV != production.
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
    /** Verbatim summary-table digest rows ("# | title | severity | …") —
     *  present when the message carries a findings table (never truncated). */
    summaryTable?: string[];
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
  /** Honest capability gate (§6): only true when a REAL contract is implemented and verified. */
  contractAvailable: boolean;
  analyze(context: AiAnalyzeContextInput): Promise<AiProviderAnalyzeResult>;
}

/** Runtime connection options threaded from the AI configuration into the port. */
export interface ProviderPortOptions {
  /** Decrypted OpenCode credential (basic-auth password). Never logged. */
  credential?: string | null;
  /** Server base URL override (tests). Falls back to OPENCODE_SERVER_URL. */
  serverUrl?: string | null;
  /** "provider/model[@variant]" — falls back to server default-model discovery. */
  model?: string | null;
  /** fetch implementation override (tests only — never set in app code). */
  fetchImpl?: typeof fetch;
  /** Learned feedback from past human review (optional). */
  feedback?: string | null;
}

export class ProviderUnavailableError extends Error {
  code = "PROVIDER_CONTRACT_UNAVAILABLE";
  constructor(slug: string) {
    super(`The configured provider "${slug}" is not usable right now (server location or credential is missing/unreachable). AI analysis cannot run until the provider configuration is supplied and reachable. The thread was NOT altered.`);
  }
}
