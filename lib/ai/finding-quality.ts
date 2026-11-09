/**
 * Quality gates for AI-extracted finding candidates.
 *
 * AI candidates are useful only when they name a concrete vulnerability and
 * point to the source text that supports the name. Aggregate follow-ups such
 * as "reported findings are pending remediation" are status summaries, not
 * new findings, and must not become tracker rows.
 */

export interface FindingCandidateEvidence {
  messageIndex: number;
  excerpt: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW" | string;
  score?: number;
}

export interface FindingCandidateForQuality {
  identifierExplicit?: string | null;
  identifierMark?: string;
  title: string;
  titleMark: "EXPLICIT" | "AI_PROPOSED" | string;
  severity: string;
  severityMark?: string;
  evidence: FindingCandidateEvidence[];
}

const STOPWORDS = new Set([
  "a", "an", "the", "for", "of", "on", "in", "to", "at", "from", "by", "with", "and", "or",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "not", "no", "this",
  "that", "these", "those", "reported", "vapt", "finding", "findings", "test", "tests", "case", "cases", "testcase", "testcases",
  "pending", "remediation", "fix", "fixed", "fixing", "confirmed", "complete", "completed", "observation", "observations",
  "status", "issue", "issues", "thread", "email", "mail", "service", "application", "identified", "identify", "additional",
]);

const GENERIC_TITLE_PATTERNS = [
  /^reported\s+vapt\s+(findings?|test\s+cases?)/i,
  /^reported\s+(findings?|test\s+cases?)\s+for\b/i,
  /^fix\s+for\s+finding\s*#?\d*/i,
  /^fix\s+of\s+finding\b/i,
  /^finding\s+fix\s+(pending|for|confirmed|complete)/i,
  /^fix\s+pending\b/i,
  /^test\s*case\s+mention\b/i,
  /^additional\s+test\s+cases?\b/i,
  /^reported\s+test\s+cases?\s+for\b/i,
  /^.*\bpending\s+remediation\b/i,
  /^.*\bfix\s+confirmed\s+complete\b/i,
  /^.*\bconfirmed\s+complete\b/i,
  /^.*\btruncated\s+in\s+thread\b/i,
  /^third\s+vulnerability\s+entry\b/i,
];

export function isGenericFindingTitle(title: string): boolean {
  const normalized = title.trim();
  return GENERIC_TITLE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulWords(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function stem(word: string): string {
  let result = word;
  if (result.endsWith("ies") && result.length > 4) result = `${result.slice(0, -3)}y`;
  else if (result.endsWith("ing") && result.length > 5) result = result.slice(0, -3);
  else if (result.endsWith("tion") && result.length > 6) result = result.slice(0, -4);
  else if (result.endsWith("es") && result.length > 4) result = result.slice(0, -2);
  else if (result.endsWith("s") && result.length > 3) result = result.slice(0, -1);
  return result;
}

function wordMatches(titleWord: string, evidenceWord: string): boolean {
  const titleStem = stem(titleWord);
  const evidenceStem = stem(evidenceWord);
  return titleStem === evidenceStem || (
    Math.min(titleStem.length, evidenceStem.length) >= 5 &&
    (titleStem.startsWith(evidenceStem) || evidenceStem.startsWith(titleStem))
  );
}

export function titleSupportedByEvidence(
  title: string,
  evidence: FindingCandidateEvidence[],
): boolean {
  const titleWords = meaningfulWords(title);
  if (titleWords.length === 0) return false;

  const evidenceWords = evidence.flatMap((item) => meaningfulWords(item.excerpt));
  const supported = titleWords.filter((word) => evidenceWords.some((evidenceWord) => wordMatches(word, evidenceWord)));
  const supportedRatio = supported.length / titleWords.length;

  return supported.length >= 2 && supportedRatio >= 0.5;
}

export function validateFindingCandidate(candidate: FindingCandidateForQuality): string[] {
  const reasons: string[] = [];

  if (candidate.title.trim().length < 3) reasons.push("Finding title is empty or unusable.");
  if (isGenericFindingTitle(candidate.title)) {
    reasons.push("Title is a generic status/remediation summary rather than a concrete vulnerability name.");
  }
  if (candidate.severity === "unknown") {
    reasons.push("Severity is unknown; an unknown-severity AI candidate cannot feed the tracker.");
  }
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
    reasons.push("Finding has no source evidence.");
  }
  if (
    candidate.titleMark !== "EXPLICIT" &&
    candidate.identifierMark !== "IDENTIFIER_EXPLICIT" &&
    !titleSupportedByEvidence(candidate.title, candidate.evidence ?? [])
  ) {
    reasons.push("AI-proposed title is not sufficiently supported by the quoted evidence.");
  }
  if (
    candidate.identifierExplicit &&
    candidate.identifierMark === "IDENTIFIER_NOT_EXPLICIT"
  ) {
    reasons.push("An explicit identifier is present but the candidate is marked as not explicit.");
  }

  return reasons;
}

export function isEvidenceBackedFindingCandidate(candidate: FindingCandidateForQuality): boolean {
  return validateFindingCandidate(candidate).length === 0;
}
