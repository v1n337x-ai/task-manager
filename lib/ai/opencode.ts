/**
 * OpenCode provider adapter (Phase 5.1) — REAL HTTP contract of the local
 * OpenCode v2 server, verified live against `opencode serve` (v2.2.5).
 *
 * Verified contract (no invented endpoints):
 *   - Authentication: HTTP basic auth, username "opencode", password = the
 *     OpenCode credential (minted via `opencode pair` → /auth/connect/<code>).
 *   - Connection check: GET /api/info → {"version","pid","hostname","urls",...}
 *   - One-shot generation: POST /api/experimental/generate/text
 *     body  {"prompt": string, "model": {"providerID": string, "id": string}}
 *     200   {"data": {"text": string}}
 *     400 invalid request · 401 unauthorized · 5xx provider/service errors
 *   - Default model discovery: GET /api/model/default → data.id/providerID
 *
 * The server location is configuration, not code: OPENCODE_SERVER_URL (the
 * background service prints its port via `opencode service status`).
 * Credentials live ONLY in the encrypted AI configuration row (Settings → AI)
 * or OPENCODE_SERVER_PASSWORD — never in source, never logged.
 */
import { Buffer } from "node:buffer";

/** Base URL access — reads env every call (no caching), returns null when unset. */
export function getOpenCodeBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.OPENCODE_SERVER_URL?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new OpenCodeConfigError("OPENCODE_SERVER_URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OpenCodeConfigError("OPENCODE_SERVER_URL must be an http(s) URL.");
  }
  return raw.replace(/\/+$/, "");
}

export interface OpenCodeModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

/** "provider/model" → Model.Ref shape. Variant suffix "@variant" optional. */
export function parseOpenCodeModelRef(raw: string): OpenCodeModelRef {
  const [pair, variant] = raw.split("@");
  const slash = pair!.lastIndexOf("/");
  if (slash <= 0 || slash === pair!.length - 1) {
    throw new OpenCodeConfigError(`OPENCODE_MODEL must be "provider/model": received "${raw}".`);
  }
  const providerID = pair!.slice(0, slash);
  const id = pair!.slice(slash + 1);
  if (providerID.includes("/") || providerID.includes("@") || id.includes("/") || id.includes("@")) {
    throw new OpenCodeConfigError(`OPENCODE_MODEL must be "provider/model": received "${raw}".`);
  }
  const ref: OpenCodeModelRef = { providerID, id };
  if (variant) ref.variant = variant;
  return ref;
}

/** Basic auth username for OpenCode servers (fixed by the server contract). */
export const OPENCODE_AUTH_USER = "opencode";

export function opencodeAuthHeader(credential: string): string {
  return `Basic ${Buffer.from(`${OPENCODE_AUTH_USER}:${credential}`, "utf8").toString("base64")}`;
}

export type OpenCodePingFailure =
  | { ok: false; kind: "auth"; message: string }
  | { ok: false; kind: "network"; message: string }
  | { ok: false; kind: "status"; message: string };

export interface OpenCodePingSuccess {
  ok: true;
  version: string | null;
  urls: string[];
}

/** GET /api/info — the honest server reachability + credential check. */
export async function pingOpenCode(options: { baseUrl: string; credential: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<OpenCodePingSuccess | OpenCodePingFailure> {
  const f = options.fetchImpl ?? fetch;
  try {
    const res = await f(new URL("/api/info", options.baseUrl), {
      headers: { Authorization: opencodeAuthHeader(options.credential) },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, kind: "auth", message: "The OpenCode server authenticated the request as invalid credential." };
    }
    if (!res.ok) {
      return { ok: false, kind: "status", message: `OpenCode /api/info returned HTTP ${res.status}.` };
    }
    const body = (await res.json().catch(() => null)) as { version?: string; urls?: string[] } | null;
    return { ok: true, version: typeof body?.version === "string" ? body.version : null, urls: Array.isArray(body?.urls) ? body.urls : [] };
  } catch (error) {
    return { ok: false, kind: "network", message: `Could not reach the OpenCode server: ${truncate(String(error), 220)}` };
  }
}

export type OpenCodeGenerateFailure =
  | ({ kind: "auth" | "network" | "payload" | "status" } & { message: string });

/** GET /api/model/default → the model the server would use by default. */
export async function fetchOpenCodeDefaultModel(options: { baseUrl: string; credential: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<{ model: OpenCodeModelRef } | OpenCodeGenerateFailure> {
  const f = options.fetchImpl ?? fetch;
  try {
    const res = await f(new URL("/api/model/default", options.baseUrl), {
      headers: { Authorization: opencodeAuthHeader(options.credential) },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { kind: "auth", message: "OpenCode rejected the analysis credential (HTTP 401/403)." };
    }
    if (!res.ok) {
      return { kind: "status", message: `OpenCode /api/model/default returned HTTP ${res.status}.` };
    }
    const body = (await res.json().catch(() => null)) as { data?: { id?: string; providerID?: string } } | null;
    const id = body?.data?.id;
    const providerID = body?.data?.providerID;
    if (typeof id !== "string" || typeof providerID !== "string") {
      return { kind: "payload", message: "OpenCode /api/model/default response was not understandable." };
    }
    return { model: { providerID, id } };
  } catch (error) {
    return { kind: "network", message: `OpenCode request failed: ${truncate(String(error), 220)}` };
  }
}

/** POST /api/experimental/generate/text — one deterministic completion. */
export async function generateOpenCodeText(options: {
  baseUrl: string;
  credential: string;
  model: OpenCodeModelRef;
  prompt: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string } | OpenCodeGenerateFailure> {
  const f = options.fetchImpl ?? fetch;
  const model: OpenCodeModelRef = options.model.variant ? { ...options.model, variant: options.model.variant } : { ...options.model };
  let body: string;
  try {
    body = JSON.stringify({ prompt: options.prompt, model });
  } catch (error) {
    return { kind: "payload", message: `Failed to serialize analysis request: ${truncate(String(error), 120)}` };
  }
  try {
    const res = await f(new URL("/api/experimental/generate/text", options.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: opencodeAuthHeader(options.credential) },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? Number(process.env.OPENCODE_TIMEOUT_MS ?? 120_000)),
    });
    if (res.status === 401 || res.status === 403) {
      return { kind: "auth", message: "OpenCode rejected the analysis credential (HTTP 401/403)." };
    }
    if (res.status === 404) {
      return { kind: "status", message: "Model not found on the OpenCode server (HTTP 404)." };
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")) || "";
      return { kind: "status", message: `OpenCode generation failed (HTTP ${res.status}). ${truncate(detail, 180)}` };
    }
    const parsed = (await res.json().catch(() => null)) as { data?: { text?: string } } | null;
    const text = parsed?.data?.text;
    if (typeof text !== "string") {
      return { kind: "payload", message: "OpenCode response did not contain data.text." };
    }
    return { text };
  } catch (error) {
    return { kind: "network", message: `OpenCode request failed: ${truncate(String(error), 220)}` };
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export class OpenCodeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenCodeConfigError";
  }
}
