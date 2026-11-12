/**
 * Deterministic context builder (Phase 5 §9-§10, §48).
 * - Chronological messages, capped per-message character budget, evidence
 *   statements never cut mid-sentence where avoidable.
 * - Context hash: sha256 of the CANONICAL serialization — identical thread
 *   content ⇒ identical hash (§49 idempotency signal).
 */
import { createHash } from "node:crypto";
import type { AiAnalyzeContextInput } from "./providers";
import { extractSummaryRows, formatSummaryDigest } from "./summary-table-digest";
import { MAX_MESSAGES, selectAnalysisMessages } from "./summary-window";

export interface ContextBuildResult {
  context: AiAnalyzeContextInput;
  hash: string;
  reduced: boolean;
  reductions: string[];
}

const MAX_BODY_CHARS = 1800;

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

  // DETERMINISTIC TABLE DIGEST (before any selection): messages that carry a
  // findings summary table are the authoritative report surface. They are
  // ALWAYS kept in the window, even beyond the newest-12 cap, and their rows
  // are carried verbatim as a compact digest that survives the per-message
  // character budget. Selection itself comes from the SHARED helper so the
  // evidence validator sees the identical window.
  const digests = chronological.map((m) => formatSummaryDigest(extractSummaryRows(m.bodyText)));
  const { selected, carrierCount } = selectAnalysisMessages(chronological);
  if (chronological.length > selected.length || carrierCount > 0) {
    reductions.push(
      `window: newest ${Math.min(MAX_MESSAGES, chronological.length)} of ${chronological.length} messages (+${carrierCount} table carriers)`,
    );
  }

  // O(n) digest lookup (identity map) — indexOf per message was quadratic on
  // large imported threads and visibly slowed context building.
  const digestByMessage = new Map<object, string[]>();
  chronological.forEach((m, i) => digestByMessage.set(m, digests[i] ?? []));

  const context: AiAnalyzeContextInput = {
    applicationName: input.applicationName,
    applicationUrl: input.applicationUrl,
    applicationAliases: input.applicationAliases,
    iterations: input.iterations,
    existingFindings: input.existingFindings,
    existingTestCases: input.existingTestCases,
    subject: input.subject,
    messages: selected.map((m, i) => {
      const rows = digestByMessage.get(m) ?? [];
      if (rows.length > 0) reductions.push(`message #${i} carries ${rows.length} summary-table row(s) (digest kept verbatim)`);
      let body = m.bodyText ?? "";
      if (body.length > MAX_BODY_CHARS) {
        // Preserve statement completeness: cut at the last sentence end before the cap.
        const cut = body.lastIndexOf(". ", MAX_BODY_CHARS);
        body = body.slice(0, cut > MAX_BODY_CHARS / 2 ? cut + 1 : MAX_BODY_CHARS);
        if (rows.length === 0) {
          reductions.push(`message #${i} body truncated to ${cut > MAX_BODY_CHARS / 2 ? cut : MAX_BODY_CHARS} chars`);
        }
      }
      return {
        index: i,
        from: m.from,
        recipients: m.recipients,
        sentAt: m.sentAt?.toISOString() ?? null,
        bodyText: body,
        participants: m.participants,
        ...(rows.length > 0 ? { summaryTable: rows } : {}),
      };
    }),
  };

  const hash = createHash("sha256").update(JSON.stringify(context)).digest("hex");
  return { context, hash, reduced: reductions.length > 0, reductions };
}
