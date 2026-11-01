/**
 * Deterministic context builder (Phase 5 §9-§10, §48).
 * - Chronological messages, capped per-message character budget, evidence
 *   statements never cut mid-sentence where avoidable.
 * - Context hash: sha256 of the CANONICAL serialization — identical thread
 *   content ⇒ identical hash (§49 idempotency signal).
 */
import { createHash } from "node:crypto";
import type { AiAnalyzeContextInput } from "./providers";

export interface ContextBuildResult {
  context: AiAnalyzeContextInput;
  hash: string;
  reduced: boolean;
  reductions: string[];
}

const MAX_MESSAGES = 30;
const MAX_BODY_CHARS = 4000;

export function buildAnalysisContext(input: {
  applicationName: string | null;
  applicationUrl: string | null;
  applicationAliases: string[];
  iterations: { number: number; name: string; type: string; status: string }[];
  existingFindings: { code: string; title: string; severity: string; status: string; testCase: string | null }[];
  existingTestCases: { code: string; title: string; state: string }[];
  subject: string | null;
  messages: { from: string; recipients: string[]; sentAt: Date | null; bodyText: string | null; participants: string[] }[];
}): ContextBuildResult {
  const reductions: string[] = [];
  const chronological = [...input.messages].sort((a, b) => {
    const ta = a.sentAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = b.sentAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });

  let selected = chronological;
  if (selected.length > MAX_MESSAGES) {
    reductions.push(`thread truncated from ${selected.length} to newest ${MAX_MESSAGES} messages`);
    selected = selected.slice(-MAX_MESSAGES);
  }

  const context: AiAnalyzeContextInput = {
    applicationName: input.applicationName,
    applicationUrl: input.applicationUrl,
    applicationAliases: input.applicationAliases,
    iterations: input.iterations,
    existingFindings: input.existingFindings,
    existingTestCases: input.existingTestCases,
    subject: input.subject,
    messages: selected.map((m, i) => {
      let body = m.bodyText ?? "";
      if (body.length > MAX_BODY_CHARS) {
        // Preserve statement completeness: cut at the last sentence end before the cap.
        const cut = body.lastIndexOf(". ", MAX_BODY_CHARS);
        body = body.slice(0, cut > MAX_BODY_CHARS / 2 ? cut + 1 : MAX_BODY_CHARS);
        reductions.push(`message #${i} body truncated to ${cut > MAX_BODY_CHARS / 2 ? cut : MAX_BODY_CHARS} chars`);
      }
      return {
        index: i,
        from: m.from,
        recipients: m.recipients,
        sentAt: m.sentAt?.toISOString() ?? null,
        bodyText: body,
        participants: m.participants,
      };
    }),
  };

  const hash = createHash("sha256").update(JSON.stringify(context)).digest("hex");
  return { context, hash, reduced: reductions.length > 0, reductions };
}
