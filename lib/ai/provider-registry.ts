/**
 * Provider registry (§5). "opencode" carries the REAL, live-verified OpenCode
 * v2 HTTP contract (lib/ai/opencode.ts — Phase 5.1). The "mock" provider is a
 * deterministic TEST fixture (§79) — never selectable in production.
 */
import type {
  AiProviderPort,
  AiAnalyzeContextInput,
  AiProviderAnalyzeResult,
  ProviderPortOptions,
} from "./providers";
import { ProviderUnavailableError } from "./providers";
import {
  OpenCodeConfigError,
  fetchOpenCodeDefaultModel,
  generateOpenCodeText,
  getOpenCodeBaseUrl,
  parseOpenCodeModelRef,
} from "./opencode";
import { buildExtractionPrompt } from "./prompt";

/** Naive but DETERMINISTIC keyword extraction over the given context — test-only. */
function mockAnalyze(context: AiAnalyzeContextInput): AiProviderAnalyzeResult {
  const messages = context.messages;
  const evidenceFor = (messageIndex: number, excerpt: string, confidence: "HIGH" | "MEDIUM" | "LOW" = "HIGH") => ({
    messageIndex,
    excerpt,
    confidence,
  });

  const participants = new Map<string, { email: string; role: "pentester" | "developer" | "other" | "unknown"; quote: string; messageIndex: number }>();
  messages.forEach((m, index) => {
    if (!participants.has(m.from) && m.from) {
      const body = (m.bodyText ?? "").toLowerCase();
      let role: "pentester" | "developer" | "other" | "unknown" = "unknown";
      const quote = (m.bodyText ?? "").slice(0, 140);
      if (/retest|still (vulnerable|reproducible)|validated as (fixed|not passed)|retest(ed)? (and|result)|penetration/.test(body)) {
        role = "pentester";
      } else if (/fixed|deployed|release|patch|remediat/.test(body)) {
        role = "developer";
      } else if (m.from.includes("digialert") || /(pentester|tester)/.test(m.from)) {
        role = "pentester";
      } else if (m.from.includes("akasa")) {
        role = "other";
      }
      participants.set(m.from, { email: m.from, role, quote, messageIndex: index });
    }
  });

  const findings: unknown[] = [];
  const statusSignals: string[] = [];
  messages.forEach((m, index) => {
    const body = m.bodyText ?? "";
    const lower = body.toLowerCase();
    const explicitId = body.match(/F-\d{3}/)?.[0] ?? null;
    const hasFixed = /(has been fixed|is fixed|are fixed|fixed and deployed|validated as fixed)/.test(lower);
    const hasNotFixed = /(still vulnerable|still reproducible|not fixed|remains exploitable)/.test(lower);
    if (hasFixed || hasNotFixed) {
      statusSignals.push(m.index.toString(10));
      findings.push({
        identifierExplicit: explicitId,
        identifierMark: explicitId ? "IDENTIFIER_EXPLICIT" : "IDENTIFIER_NOT_EXPLICIT",
        title: explicitId ? `Finding ${explicitId}` : (body.split(/[.\n]/)[0] ?? "Reported issue").slice(0, 120),
        titleMark: explicitId ? "EXPLICIT" : "AI_PROPOSED",
        severity: /critical/.test(lower) ? "critical" : /high/.test(lower) ? "high" : /medium/.test(lower) ? "medium" : /low/.test(lower) ? "low" : "unknown",
        severityMark: /severity:/.test(lower) ? "EXPLICIT" : "INFERRED",
        description: body.slice(0, 500),
        recommendation: null,
        relatedTestCaseRefs: [],
        iterationSignal: /iteration\s*(\d+)|retest/.test(lower) ? (Number(body.match(/iteration\s*(\d+)/i)?.[1] ?? 2)) : null,
        iterationSignalExplicit: /iteration\s*\d+/i.test(lower),
        statusSignal: hasFixed ? "fixed" : "not_fixed",
        isNewFindingCandidate: body.includes("new finding"),
        evidence: [evidenceFor(index, body.slice(0, 160).trim() || (m.bodyText ?? ""), hasFixed && hasNotFixed ? "MEDIUM" : "HIGH")],
      });
    }
    const tc = body.match(/TC-\d{3}/)?.[0];
    if ((tc || /test case/i.test(body)) && body.length > 0) {
      findings.push({
        identifierExplicit: null,
        identifierMark: "IDENTIFIER_NOT_EXPLICIT",
        title: `TestCase mention: ${tc ?? body.slice(0, 80)}`,
        titleMark: "AI_PROPOSED",
        severity: "unknown",
        severityMark: "INFERRED",
        description: body.slice(0, 300),
        recommendation: null,
        relatedTestCaseRefs: tc ? [tc] : [],
        iterationSignal: /iteration\s*(\d+)/i.exec(body)?.[1] ? Number(/iteration\s*(\d+)/i.exec(body)![1]) : null,
        iterationSignalExplicit: /iteration\s*\d+/i.test(body),
        statusSignal: null,
        isNewFindingCandidate: false,
        evidence: [evidenceFor(index, body.slice(0, 160).trim())],
      });
    }
  });

  return {
    ok: true,
    structured: {
      schemaVersion: "AI_EXTRACTION_V1",
      threadSummary:
        `Thread "${context.subject ?? "(no subject)"}" contains ${messages.length} messages between ${[...participants.keys()].join(", ")}. ` +
        (statusSignals.length ? `Status signals detected in messages ${statusSignals.join(", ")}.` : "No status statements detected."),
      participants: [...participants.values()].map((p) => ({
        email: p.email,
        name: p.email,
        proposedRole: p.role === "other" || p.role === "unknown" ? "unknown" : p.role,
        roleBasis: p.role === "unknown" ? "INFERRED" : "EXPLICIT",
        confidence: p.role === "unknown" ? "LOW" : "MEDIUM",
        score: p.role === "unknown" ? 0.35 : 0.72,
        evidence: [evidenceFor(p.messageIndex, p.quote, p.role === "unknown" ? "LOW" : "MEDIUM")],
      })),
      findings,
      testCases: [],
      iterationSignals: messages.some((m) => /iteration|retest/i.test(m.bodyText ?? "")) || context.iterations.length > 0
        ? [{
            candidateIteration: 1,
            typeSignal: "retest",
            explicitOrInferred: "INFERRED",
            confidence: "MEDIUM",
        evidence: [evidenceFor(0, messages[0]?.bodyText?.slice(0, 140) ?? "thread context", "MEDIUM")],
          }]
        : [],
      evidence: [evidenceFor(0, context.subject ?? "(no subject)", "MEDIUM")],
    },
    provider: "mock",
    modelRaw: "deterministic-test-mock",
    warnings: ["Deterministic mock provider — evidence derived from fixture heuristics (test environments only)."],
  };
}

export function listRunProviders(): { slug: string; contractAvailable: boolean; testOnly: boolean }[] {
  return [
    { slug: "opencode", contractAvailable: true, testOnly: false },
    { slug: "mock", contractAvailable: true, testOnly: true },
  ];
}

/** Real OpenCode port — configuration arrives via ProviderPortOptions (never hardcoded). */
function opencodePort(options: ProviderPortOptions): AiProviderPort {
  const configuredModel = options.model?.trim() || process.env.OPENCODE_MODEL?.trim() || null;
  return {
    slug: "opencode",
    modelRaw: configuredModel,
    contractAvailable: true,
    analyze: async (context) => {
      const serverUrl = options.serverUrl?.trim() || getOpenCodeBaseUrl();
      const credential = options.credential?.trim() || process.env.OPENCODE_SERVER_PASSWORD?.trim() || "";
      if (!serverUrl || !credential) {
        throw new ProviderUnavailableError("opencode");
      }
      let modelRef;
      if (configuredModel) {
        modelRef = parseOpenCodeModelRef(configuredModel);
      } else {
        const discovered = await fetchOpenCodeDefaultModel({ baseUrl: serverUrl, credential, fetchImpl: options.fetchImpl });
        if ("model" in discovered) modelRef = discovered.model;
        else throw new Error(discovered.message);
      }

      const result = await generateOpenCodeText({
        baseUrl: serverUrl,
        credential,
        model: modelRef,
        prompt: buildExtractionPrompt(context),
        fetchImpl: options.fetchImpl,
      });
      if ("text" in result) {
        return {
          ok: true,
          structured: result.text,
          provider: "opencode",
          modelRaw: `${modelRef.providerID}/${modelRef.id}`,
          warnings: [],
        };
      }
      throw new Error(result.message);
    },
  };
}

export function resolveProviderPort(slug: string, isProduction: boolean, options: ProviderPortOptions = {}): AiProviderPort {
  if (slug === "opencode") {
    return opencodePort(options);
  }
  if (slug === "mock") {
    if (isProduction) {
      throw new MockProviderProductionError();
    }
    return {
      slug: "mock",
      modelRaw: "deterministic-test-mock",
      contractAvailable: true,
      analyze: async (context) => mockAnalyze(context),
    };
  }
  throw new UnknownProviderSlugError(slug);
}

export { OpenCodeConfigError };

class MockProviderProductionError extends Error {
  constructor() {
    super("Mock AI provider is unavailable in production environments.");
  }
}
class UnknownProviderSlugError extends Error {
  constructor(slug: string) {
    super(`Unknown AI provider slug: ${slug}`);
  }
}
