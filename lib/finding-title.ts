/**
 * Universal near-duplicate detection for finding titles.
 *
 * Retest reports routinely rewrite the same vulnerability slightly:
 *   "Outdated and Vulnerable  JS version" -> "Outdated and Vulnerable and JS version"
 *   "Sensitive paths in Manifest leads to forced browsing" -> "Sensitive Paths in Manifest lead to Forced Browsing"
 * Pure equality / prefix matching creates a SECOND tracker row, which splits
 * the I1 and I2 verdicts and renders one row with "—". Fold stop words and
 * simple plurals/verb forms into a canonical token set so these become one
 * finding while genuinely distinct vulnerabilities stay separate.
 */
const STOP_WORDS = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "via", "with", "from", "by", "is", "are", "as", "at"]);

function canonical(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("sses")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map(canonical);
}

/**
 * Deterministic canonical-token-set equality — no fuzzy threshold, so two
 * genuinely different findings can never be merged by accident.
 */
export function isSameFindingTitle(a: string, b: string): boolean {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.length < 3 || tb.length < 3 || ta.length !== tb.length) return false;
  return [...ta].sort().join(" ") === [...tb].sort().join(" ");
}
