/**
 * Deterministic summary-table digest for AI context (user-directed 2026-11).
 *
 * Long VAPT report mails embed the findings table as plain text in the
 * mail body. The per-message character cap previously cut these tables, so
 * the AI only saw the 1-2 findings that happened to fall inside the last
 * 1,800 chars — the tracker got 2 rows while the thread reported 10+.
 *
 * This digest extracts the table rows VERBATIM (number, title, severity and,
 * when present, status/comment columns) into compact lines that survive the
 * message budget. Same parsing semantics as the conversation renderer:
 *   - vertical field-per-line:  "#", "Name…", "Severity"[, "Status"...]
 *   - one-line:                 "# Name of the vulnerability Severity Status"
 *   - pipe-delimited:           "1 | Title | High | Fixed"
 * Nothing is inferred: a row without a recognizable severity is skipped.
 */

export interface SummaryRowDigest {
  no: string;
  title: string;
  severity: string | null;
  rest: string;
}

const SEVERITY_WORDS = new Set([
  "critical", "high", "medium", "low", "info", "informational",
]);

const TITLE_NOISE = new Set([
  "name of the vulnerability", "name of the vulnerability ", "vulnerability",
  "name", "title", "finding", "severity", "status", "#", "s.no", "sno",
  "application team comments", "infosec response", "comments", "response",
  "application team comment", "infosec comment", "remarks", "remark",
]);

function isLikelyTitle(line: string): boolean {
  const t = line.trim().toLowerCase();
  return t.length >= 6 && !TITLE_NOISE.has(t) && !/^\d+$/.test(t);
}

function isSeverity(line: string): string | null {
  const t = line.trim().toLowerCase().replace(/[^a-z]/g, "");
  return SEVERITY_WORDS.has(t) ? t : null;
}

/**
 * Parse the vertical table layout: a "#" header, then repeated groups of
 * [number, title, severity, optional free-text columns…]. Group boundaries:
 * the next standalone number. Free-text continuation lines are absorbed into
 * the trailing `rest` (status/comment text) until the next number.
 */
function parseVertical(lines: string[]): SummaryRowDigest[] {
  const rows: SummaryRowDigest[] = [];
  let current: { no: string; title: string; severity: string | null; rest: string[] } | null = null;
  const flush = () => {
    if (current && current.title.length >= 6) {
      rows.push({ no: current.no, title: current.title, severity: current.severity, rest: current.rest.join(" ").trim().slice(0, 300) });
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    if (/^\d{1,3}[.)]?$/.test(line)) {
      flush();
      current = { no: line.replace(/[.)]$/, ""), title: "", severity: null, rest: [] };
      continue;
    }
    if (current === null) continue;
    if (current.title === "") {
      if (isLikelyTitle(line)) current.title = line;
      continue;
    }
    const sev = isSeverity(line);
    if (sev !== null && current.severity === null) {
      current.severity = sev;
      continue;
    }
    if (current.severity !== null) current.rest.push(line);
    else if (isLikelyTitle(line) && current.title.length < 300) current.title = `${current.title} ${line}`.trim();
  }
  flush();
  return rows;
}

/** One-line rows: "1 Title text High [Status …]" and "1 | Title | High | …". */
function parseOneLine(lines: string[]): SummaryRowDigest[] {
  const rows: SummaryRowDigest[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = /^(\d{1,3})\s*[|.)]?\s+(.+)$/.exec(line);
    if (!m) continue;
    const no = m[1]!;
    let rest = m[2]!;
    const pipeParts = rest.split("|").map((p) => p.trim());
    if (pipeParts.length >= 2 && isSeverity(pipeParts[1] ?? "")) {
      rows.push({ no, title: pipeParts[0] ?? "", severity: pipeParts[1] ?? null, rest: pipeParts.slice(2).join(" · ") });
      continue;
    }
    const tokens = rest.split(/\s+/);
    // Find a severity token scanning from the END backwards (status words may
    // themselves contain severity-like fragments; severity is the LAST pure
    // severity word before the status/comment text starts).
    let sevIndex = -1;
    let sevValue: string | null = null;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const s = isSeverity(tokens[i] ?? "");
      if (s) {
        sevIndex = i;
        sevValue = s;
        break;
      }
    }
    if (sevIndex < 0 || !sevValue) continue;
    const title = tokens.slice(0, sevIndex).join(" ").replace(/[|]+$/, "").trim();
    if (title.length < 6) continue;
    rows.push({ no, title, severity: sevValue, rest: tokens.slice(sevIndex + 1).join(" ") });
  }
  return rows;
}

export function extractSummaryRows(bodyText: string | null | undefined): SummaryRowDigest[] {
  if (!bodyText) return [];
  const cleaned = bodyText.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
  const lines = cleaned.split("\n");
  const digestLimit = 400_000; // cap scan cost; tables live near the head/tail
  const window = cleaned.length > digestLimit ? `${cleaned.slice(0, digestLimit / 2)}\n${cleaned.slice(-digestLimit / 2)}` : cleaned;
  void lines;
  const allLines = window.split("\n");
  const vertical = parseVertical(allLines);
  const oneLine = vertical.length >= 2 ? [] : parseOneLine(allLines);
  const rows = vertical.length >= 2 ? vertical : oneLine;
  return rows.slice(0, 50);
}

export function formatSummaryDigest(rows: SummaryRowDigest[]): string[] {
  return rows.map((r) => `#${r.no} | ${r.title} | severity: ${r.severity ?? "unknown"}${r.rest ? ` | ${r.rest}` : ""}`);
}
