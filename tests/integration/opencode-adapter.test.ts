/**
 * Phase 5.1 — real OpenCode provider adapter (contract verified live against
 * opencode v2.2.5). All HTTP is stubbed HTTP here; the live server was verified
 * separately (see docs/ai-analysis.md). Covers: config parsing, basic auth,
 * /api/info ping, connection-test truthfulness, /api/experimental/generate/text
 * port behavior, default-model discovery, and honest no-configuration failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENCODE_AUTH_USER,
  fetchOpenCodeDefaultModel,
  getOpenCodeBaseUrl,
  opencodeAuthHeader,
  parseOpenCodeModelRef,
  pingOpenCode,
} from "@/lib/ai/opencode";
import { buildExtractionPrompt } from "@/lib/ai/prompt";
import { listRunProviders, resolveProviderPort } from "@/lib/ai/provider-registry";
import { testProviderConnection } from "@/lib/ai/provider-catalog";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const VALID_V1 = {
  schemaVersion: "AI_EXTRACTION_V1",
  threadSummary: "Thread with three messages discussing retest status of F-002.",
  participants: [
    {
      email: "vineet@digialert.test",
      proposedRole: "pentester",
      roleBasis: "EXPLICIT",
      confidence: "MEDIUM",
      score: 0.8,
      evidence: [{ messageIndex: 0, excerpt: "retest result attached below", confidence: "MEDIUM" }],
    },
  ],
  findings: [
    {
      identifierExplicit: "F-002",
      identifierMark: "IDENTIFIER_EXPLICIT",
      title: "Finding F-002",
      titleMark: "EXPLICIT",
      severity: "high",
      severityMark: "EXPLICIT",
      description: null,
      recommendation: null,
      relatedTestCaseRefs: [],
      statusSignal: "not_fixed",
      evidence: [{ messageIndex: 2, excerpt: "still vulnerable", confidence: "HIGH" }],
    },
  ],
  testCases: [],
  iterationSignals: [
    { candidateIteration: 2, typeSignal: "retest", explicitOrInferred: "EXPLICIT", confidence: "HIGH", evidence: [{ messageIndex: 1, excerpt: "iteration 2 retest", confidence: "HIGH" }] },
  ],
  evidence: [{ messageIndex: 0, excerpt: "subject: retest update", confidence: "MEDIUM" }],
};

const CONTEXT = {
  applicationName: "Application X",
  applicationUrl: null,
  applicationAliases: [],
  iterations: [],
  existingFindings: [{ code: "F-001", title: "Fake one", severity: "low", status: "open", testCase: null }],
  existingTestCases: [],
  subject: "retest update",
  messages: [{ index: 0, from: "a@b.test", recipients: [], sentAt: null, bodyText: "still vulnerable", participants: [] }],
};

describe("OpenCode adapter — configuration parsing", () => {
  it("base URL: unset → null; trailing slash stripped; invalid rejected", () => {
    delete process.env.OPENCODE_SERVER_URL;
    expect(getOpenCodeBaseUrl()).toBeNull();
    process.env.OPENCODE_SERVER_URL = "http://127.0.0.1:9999/";
    expect(getOpenCodeBaseUrl()).toBe("http://127.0.0.1:9999");
    process.env.OPENCODE_SERVER_URL = "ftp://x";
    expect(() => getOpenCodeBaseUrl()).toThrow(/http\(s\)/);
  });

  it("model ref: provider/model parses; variant split; garbage rejected", () => {
    delete process.env.OPENCODE_SERVER_URL;
    const ref = parseOpenCodeModelRef("opencode-go/iceman-contributor-free");
    expect(ref).toEqual({ providerID: "opencode-go", id: "iceman-contributor-free" });
    const withVariant = parseOpenCodeModelRef("prov/model@fast");
    expect(withVariant.variant).toBe("fast");
    expect(() => parseOpenCodeModelRef("no-slash")).toThrow(/provider\/model/);
    expect(() => parseOpenCodeModelRef("who/GHE/bar")).toThrow(/provider\/model/);
    expect(() => parseOpenCodeModelRef("prov/")).toThrow(/provider\/model/);
  });

  it("basic auth is always username 'opencode'", () => {
    expect(OPENCODE_AUTH_USER).toBe("opencode");
    const header = opencodeAuthHeader("secret-cred");
    expect(header.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(header.slice(6), "base64").toString("utf8")).toBe(`opencode:secret-cred`);
  });
});

describe("OpenCode adapter — GET /api/info ping", () => {
  beforeEach(() => {
    process.env.OPENCODE_SERVER_URL = "http://127.0.0.1:9999";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reaches /api/info with basic auth and reports version", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      seenUrl = input.toString();
      seenAuth = String(new Headers(init?.headers).get("Authorization"));
      return jsonResponse(200, { version: "2.2.5", urls: ["http://127.0.0.1:9999"] });
    });
    const result = await pingOpenCode({ baseUrl: "http://127.0.0.1:9999", credential: "abc", fetchImpl: fetchMock as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: true, version: "2.2.5" });
    expect(seenUrl).toBe("http://127.0.0.1:9999/api/info");
    expect(seenAuth).toBe(opencodeAuthHeader("abc"));
  });

  it("bad credential → auth failure (truthful FAILED path)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { _tag: "UnauthorizedError" }));
    const result = await pingOpenCode({ baseUrl: "http://127.0.0.1:9999", credential: "wrong", fetchImpl: fetchMock as unknown as typeof fetch });
    expect(result).toMatchObject({ kind: "auth" });
  });

  it("unreachable server → network failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await pingOpenCode({ baseUrl: "http://127.0.0.1:9999", credential: "abc", fetchImpl: fetchMock as unknown as typeof fetch });
    expect(result).toMatchObject({ kind: "network" });
  });
});

describe("OpenCode connection test (Settings)", () => {
  beforeEach(() => {
    process.env.OPENCODE_SERVER_URL = "http://127.0.0.1:9999";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("server URL unset → honest UNAVAILABLE with configuration guidance", async () => {
    delete process.env.OPENCODE_SERVER_URL;
    const result = await testProviderConnection("opencode", "some-key");
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.message).toMatch(/until the OpenCode provider endpoint\/configuration is supplied/i);
  });

  it("200 → PASSED; 401 → FAILED; never silently fakes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { version: "2.2.5" })));
    const passed = await testProviderConnection("opencode", "good-cred");
    expect(passed.status).toBe("PASSED");
    expect(passed.message).toMatch(/Connected to OpenCode server/);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { _tag: "UnauthorizedError" })));
    const failed = await testProviderConnection("opencode", "bad-cred");
    expect(failed.status).toBe("FAILED");
    expect(failed.message).toMatch(/credential/i);
  });
});

describe("OpenCode adapter — analysis port (POST /api/experimental/generate/text)", () => {
  beforeEach(() => {
    process.env.OPENCODE_SERVER_URL = "http://127.0.0.1:9999";
    delete process.env.OPENCODE_SERVER_PASSWORD;
    delete process.env.OPENCODE_MODEL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registry marks the opencode contract as genuinely available", () => {
    const ports = listRunProviders();
    expect(ports.find((p) => p.slug === "opencode")).toMatchObject({ contractAvailable: true, testOnly: false });
  });

  it("no credential configured → honest unavailability (never fabricated data)", async () => {
    delete process.env.OPENCODE_SERVER_URL; // also unset
    const port = resolveProviderPort("opencode", false);
    await expect(port.analyze(CONTEXT)).rejects.toThrow(/no implemented API contract|cannot run until/i);
  });

  it("successful generation: prompt + model ref + basic auth over the verified endpoint", async () => {
    let seenUrl = "";
    let seenAuth = "";
    let seenBody = "";
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      seenUrl = input.toString();
      seenAuth = String(new Headers(init?.headers).get("Authorization"));
      seenBody = String(init?.body);
      return jsonResponse(200, { data: { text: JSON.stringify(VALID_V1) } });
    });
    const port = resolveProviderPort("opencode", false, {
      credential: "cred-123",
      serverUrl: "http://127.0.0.1:9999",
      model: "opencode-go/iceman-contributor-free",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const result = await port.analyze(CONTEXT);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("opencode");
    expect(result.modelRaw).toBe("opencode-go/iceman-contributor-free");
    expect(result.warnings).toEqual([]);
    expect(typeof result.structured).toBe("string");
    expect(JSON.parse(result.structured as string)).toMatchObject({ schemaVersion: "AI_EXTRACTION_V1" });
    expect(seenUrl).toBe("http://127.0.0.1:9999/api/experimental/generate/text");
    expect(seenAuth).toBe(opencodeAuthHeader("cred-123"));
    const body = JSON.parse(seenBody) as { prompt: string; model: { providerID: string; id: string } };
    expect(body.model).toEqual({ providerID: "opencode-go", id: "iceman-contributor-free" });
    expect(body.prompt).toContain("AI_EXTRACTION_V1");
    expect(body.prompt).toContain('"bodyText":"still vulnerable"');
  });

  it("falls back to GET /api/model/default when no model is configured", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      urls.push(input.toString());
      if (input.toString().endsWith("/api/model/default")) {
        return jsonResponse(200, { data: { id: "iceman-contributor-free", providerID: "opencode-go" } });
      }
      expect(String(new Headers(init?.headers).get("Authorization"))).toBe(opencodeAuthHeader("cred-xyz"));
      return jsonResponse(200, { data: { text: JSON.stringify(VALID_V1) } });
    });
    const port = resolveProviderPort("opencode", false, { credential: "cred-xyz", serverUrl: "http://127.0.0.1:9999", fetchImpl: fetchMock as unknown as typeof fetch });
    const result = await port.analyze(CONTEXT);
    expect(result.modelRaw).toBe("opencode-go/iceman-contributor-free");
    expect(urls.some((u) => u.endsWith("/api/model/default"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/api/experimental/generate/text"))).toBe(true);
  });

  it("credential rejected by the generation endpoint → truthful error message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { _tag: "UnauthorizedError" }));
    const port = resolveProviderPort("opencode", false, {
      credential: "expired",
      serverUrl: "http://127.0.0.1:9999",
      model: "opencode-go/iceman-contributor-free",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(port.analyze(CONTEXT)).rejects.toThrow(/rejected the analysis credential/);
  });

  it("non-JSON model output passes through verbatim (Zod validation lives in the analysis service)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { text: "not json at all" } }));
    const port = resolveProviderPort("opencode", false, {
      credential: "cred",
      serverUrl: "http://127.0.0.1:9999",
      model: "opencode-go/iceman-contributor-free",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    // The port NEVER mutates the payload — a malformed response reaches the
    // analysis service, which fails the run honestly against AI_EXTRACTION_V1.
    const result = await port.analyze(CONTEXT);
    expect(result.structured).toBe("not json at all");
    void VALID_V1;
  });
});

describe("default-model discovery helper", () => {
  beforeEach(() => {
    process.env.OPENCODE_SERVER_URL = "http://127.0.0.1:9999";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses data.id + data.providerID", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: { id: "m", providerID: "p" } }));
    const r = await fetchOpenCodeDefaultModel({ baseUrl: "http://127.0.0.1:9999", credential: "c", fetchImpl: fetchMock as unknown as typeof fetch });
    expect("model" in r && r.model).toEqual({ providerID: "p", id: "m" });
  });

  it("malformed body → payload failure", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: {} }));
    const r = await fetchOpenCodeDefaultModel({ baseUrl: "http://127.0.0.1:9999", credential: "c", fetchImpl: fetchMock as unknown as typeof fetch });
    expect(r).toMatchObject({ kind: "payload" });
  });
});

describe("prompt builder", () => {
  it("includes the schema contract and verbatim-evidence rules", () => {
    const prompt = buildExtractionPrompt(CONTEXT);
    expect(prompt).toContain('"AI_EXTRACTION_V1"');
    expect(prompt).toContain('"messageIndex"');
    expect(prompt).toContain('NEVER invent data');
    expect(prompt).toContain("VERBATIM substring");
    expect(prompt).toContain('"bodyText":"still vulnerable"');
    expect(prompt.endsWith("Return the AI_EXTRACTION_V1 JSON object now.")).toBe(true);
  });
});
