/**
 * Shared analysis window selection (universal fix 2026-11).
 *
 * The model sees: the newest MAX_MESSAGES messages PLUS every table-carrying
 * message (findings summary tables must always reach the model, even when
 * they are older than the window). BOTH the context builder and the evidence
 * validator MUST use this exact function — a window mismatch silently breaks
 * every approval with "AI evidence references missing message #N".
 */
import { extractSummaryRows } from "./summary-table-digest";

export const MAX_MESSAGES = 12;

/**
 * The message's OWN content — quoted reply chains (From:/Sent:/-----Original
 * Message----- blocks) are earlier mail and must NOT make a reply a
 * table-carrier. The authoritative findings-table mail is the one that
 * ORIGINALLY contained the table; replies merely quote it.
 */
function ownPortion(bodyText: string | null | undefined): string {
  const raw = bodyText ?? "";
  const cut = raw.search(/^\s*(?:>\s*)?(?:From|Sent|To|Cc|Bcc|Subject|Date|Original Message)\s*:?/im);
  return (cut >= 0 ? raw.slice(0, cut) : raw).trim();
}

function isTableCarrier(bodyText: string | null | undefined): boolean {
  return extractSummaryRows(ownPortion(bodyText)).length >= 2;
}

export function selectAnalysisMessages<T extends { bodyText?: string | null; sentAt?: Date | null }>(messages: T[]): {
  selected: T[];
  /** Indexes into the INPUT array, in selected (chronological) order. */
  selectedIndexes: number[];
  carrierCount: number;
} {
  const sortedIndexes = messages
    .map((_, i) => i)
    .sort((a, b) => {
      const ta = messages[a]!.sentAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const tb = messages[b]!.sentAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  const carrierFlags = messages.map((m) => isTableCarrier(m.bodyText));
  const newestIdx = sortedIndexes.slice(-MAX_MESSAGES);
  const newestSet = new Set(newestIdx);
  const carrierIdx = sortedIndexes.filter((i) => carrierFlags[i] && !newestSet.has(i));
  const selectedIndexes = [...carrierIdx, ...newestIdx].sort((a, b) => {
    const ta = messages[a]!.sentAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const tb = messages[b]!.sentAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
  return { selected: selectedIndexes.map((i) => messages[i]!), selectedIndexes, carrierCount: carrierIdx.length };
}
