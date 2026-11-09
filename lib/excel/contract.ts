/**
 * PT Tracker v1.0 — fixed 39-column Excel business contract (Phase 3 §24/§27).
 *
 * Every string below is copied VERBATIM from the canonical template
 * (prisma/templates/pt-tracker-v1.xlsx, the actual uploaded workbook) —
 * including trailing spaces ("Iteration-2 Date ", "Critical ") and the
 * double space in "Vulnerabilities  Closed". The header row is row 2;
 * data starts at row 3.
 *
 * Tracked columns = #1..#29 (A..AC single block) + #31..#40 (AE..AN
 * severity Open/Closed matrix). Structural blanks #30 (AD) and #41 (AO)
 * are outside the 39-column contract.
 */
export const TRACKER_SHEET = "VAPT tracker";
export const HEADER_ROW = 2;
export const DATA_START_ROW = 3;
export const LAST_TEMPLATE_DATA_ROW = 32;
export const SCHEMA_NAME = "PT Tracker";
export const SCHEMA_VERSION = "1.0";

export type ColumnKind =
  | "serial"
  | "application"
  | "scope"
  | "target"
  | "mailSubject"
  | "type"
  | "assessmentSource"
  | "poc"
  | "assigned"
  | "overallStatus"
  | "totalVulnCount"
  | "date"
  | "dateOrBlank"
  | "text"
  | "longText"
  | "int"
  | "matrixOpenClosed";

export interface ContractColumn {
  /** 1-based Excel column number (A=1). */
  index: number;
  /** Excel letter. */
  letter: string;
  /** EXACT header text (may include trailing spaces); null = structural blank. */
  header: string | null;
  kind: ColumnKind;
  required: boolean;
}

export const TRACKER_COLUMNS: ContractColumn[] = [  { index: 1, letter: "A", header: "S.no", kind: "serial", required: false },
  { index: 2, letter: "B", header: "Application", kind: "application", required: true },
  { index: 3, letter: "C", header: "Internal / External", kind: "scope", required: true },
  { index: 4, letter: "D", header: "Web URL/API/FQDN", kind: "target", required: false },
  { index: 5, letter: "E", header: "Mail Subject", kind: "mailSubject", required: false },
  { index: 6, letter: "F", header: "Type", kind: "type", required: true },
  { index: 7, letter: "G", header: "Source / tool", kind: "assessmentSource", required: true },
  { index: 8, letter: "H", header: "POC Task Manager", kind: "poc", required: false },
  { index: 9, letter: "I", header: "security-vendor Team - Assigned member", kind: "assigned", required: false },
  { index: 10, letter: "J", header: "Overall Status", kind: "overallStatus", required: true },
  { index: 11, letter: "K", header: "Total Vuln Count", kind: "totalVulnCount", required: false },
  { index: 12, letter: "L", header: "Scan/Report Date", kind: "date", required: true },
  { index: 13, letter: "M", header: "Requested date", kind: "dateOrBlank", required: false },
  { index: 14, letter: "N", header: "iteration - 1 Date", kind: "dateOrBlank", required: false },
  { index: 15, letter: "O", header: "Iteration - 1 Status", kind: "overallStatus", required: false },
  { index: 16, letter: "P", header: "Iteration-2 Date ", kind: "dateOrBlank", required: false },
  { index: 17, letter: "Q", header: "Iteration - 2 Status", kind: "overallStatus", required: false },
  { index: 18, letter: "R", header: "Comments", kind: "longText", required: false },
  { index: 19, letter: "S", header: "Follow-up", kind: "dateOrBlank", required: false },
  { index: 20, letter: "T", header: "Follow-up Response", kind: "longText", required: false },
  { index: 21, letter: "U", header: "Critical ", kind: "int", required: false },
  { index: 22, letter: "V", header: "High ", kind: "int", required: false },
  { index: 23, letter: "W", header: "Medium ", kind: "int", required: false },
  { index: 24, letter: "X", header: "Low", kind: "int", required: false },
  { index: 25, letter: "Y", header: "Info ", kind: "int", required: false },
  { index: 26, letter: "Z", header: "CAR", kind: "int", required: false },
  { index: 27, letter: "AA", header: "Total", kind: "int", required: false },
  { index: 28, letter: "AB", header: "Pending", kind: "int", required: false },
  { index: 29, letter: "AC", header: "Vulnerabilities  Closed", kind: "int", required: false },
  { index: 30, letter: "AD", header: null, kind: "text", required: false }, // spacer — outside contract
  { index: 31, letter: "AE", header: "Open", kind: "matrixOpenClosed", required: false },
  { index: 32, letter: "AF", header: "Closed", kind: "matrixOpenClosed", required: false },
  { index: 33, letter: "AG", header: "Open", kind: "matrixOpenClosed", required: false },
  { index: 34, letter: "AH", header: "Closed", kind: "matrixOpenClosed", required: false },
  { index: 35, letter: "AI", header: "Open", kind: "matrixOpenClosed", required: false },
  { index: 36, letter: "AJ", header: "Closed", kind: "matrixOpenClosed", required: false },
  { index: 37, letter: "AK", header: "Open", kind: "matrixOpenClosed", required: false },
  { index: 38, letter: "AL", header: "Closed", kind: "matrixOpenClosed", required: false },
  { index: 39, letter: "AM", header: "Open", kind: "matrixOpenClosed", required: false },
  { index: 40, letter: "AN", header: "Closed", kind: "matrixOpenClosed", required: false },
];

export const TRACKED_CONTRACT_COLUMNS = TRACKER_COLUMNS.filter((c) => c.letter !== "AD" && c.letter !== "AO");
export const CONTRACT_COLUMNS_COUNT = 39;

/** Mermaid: row-1 group labels (merged) per matrix pair AE..AN. */
export const MATRIX_GROUP_ROW_1: Record<number, string> = {
  31: "Critical ",
  32: "Critical ",
  33: "High",
  34: "High",
  35: "Medium",
  36: "Medium",
  37: "Low",
  38: "Low",
  39: "Info",
  40: "Info",
};

/** Legal raw vocabulary observed in the real workbook (DL-03 §5) → canonical. */
export const SCOPE_MAP: Record<string, string> = {
  "internal": "internal",
  "external": "external",
};

export const TYPE_MAP: Record<string, string> = {
  web: "web",
  "web application": "web",
  mobile: "mobile",
  "mobile application": "mobile",
  api: "api",
  "api / chatbot service": "api",
  "web / chatbot": "web",
  apk: "mobile",
};

export const ENGAGEMENT_STATUS_MAP: Record<string, string> = {
  "in progress": "in_progress",
  completed: "completed",
  pending: "pending",
  "on hold": "on_hold",
  "on-hold": "on_hold",
  initiated: "initiated",
  "initiated / walkthrough pending": "initiated",
  "initiated / walkthrough pending ": "initiated",
  awaiting: "pending",
  "awaiting retest": "pending",
  "retest pending": "pending",
  "open - retest": "pending",
  "open — retest": "pending",
};

/** Export: canonical → what the workbook historically displayed. */
export const CANONICAL_STATUS_TO_RAW: Record<string, string> = {
  in_progress: "In Progress",
  completed: "Completed",
  pending: "Pending",
  on_hold: "On Hold",
  initiated: "Initiated / Walkthrough Pending",
  cancelled: "Cancelled",
};

export const CANONICAL_TYPE_TO_RAW: Record<string, string> = {
  web: "Web",
  mobile: "Mobile",
  api: "API",
  other: "Other",
};

export const CANONICAL_SCOPE_TO_RAW: Record<string, string> = {
  internal: "Internal",
  external: "External",
};

/** Raw string → canonical kind normalizer for a column (used by reader). */
export function canonicalizeColumnValue(col: ContractColumn, raw: string): { value: string | null; warning?: string } {
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase();
  switch (col.kind) {
    case "scope": {
      let v = SCOPE_MAP[key];
      if (!v && key.includes("internal")) { v = "internal"; return { value: v, warning: `Non-standard scope value "${raw}" interpreted as Internal.` }; }
      if (!v && key.includes("external")) { v = "external"; return { value: v, warning: `Non-standard scope value "${raw}" interpreted as External.` }; }
      return { value: v ?? null, warning: v ? undefined : `Unrecognized scope "${raw}".` };
    }
    case "type": {
      const v = TYPE_MAP[key];
      if (v) return { value: v };
      if (key.includes("web")) return { value: "web", warning: `Non-standard type "${raw}" mapped to web.` };
      if (key.includes("mobile") || key.includes("apk")) return { value: "mobile", warning: `Non-standard type "${raw}" mapped to mobile.` };
      if (key.includes("api")) return { value: "api", warning: `Non-standard type "${raw}" mapped to api.` };
      return { value: "other", warning: `Unrecognized type "${raw}" stored as Other.` };
    }
    case "assessmentSource": {
      if (key.includes("manual") && key.includes("burp")) return { value: "manual_burp" };
      if (key.includes("mobsf") && key.includes("manual")) return { value: "manual_mobsf" };
      if (key.includes("manual + revalidation")) return { value: "manual_revalidation" };
      if (key.includes("ai")) return { value: "ai_assisted" };
      if (key.includes("black box")) return { value: "vapt_blackbox" };
      if (key.includes("vapt")) return { value: "vapt" };
      if (key.includes("manual")) return { value: "manual_burp", warning: `Non-standard source "${raw}" mapped to Manual Testing / Burp.` };
      return { value: "other", warning: `Unrecognized source/tool "${raw}" stored as Other.` };
    }
    case "overallStatus": {
      const v = ENGAGEMENT_STATUS_MAP[key];
      if (v) return { value: v };
      if (!trimmed) return { value: null };
      return { value: null, warning: `Unrecognized overall/iteration status "${raw}".` };
    }
    default:
      return { value: trimmed || null };
  }
}

/**
 * Single source of truth for Open / Closed / CAR buckets.
 *
 * User semantics (2026-11): Open = not yet fixed/closed;
 * Closed = fixed + not fixed + reopened + CAR.
 *
 * Every rollup — the Excel export's per-app and per-iteration buckets AND the
 * web iteration summaries — consumes THESE sets, so a number on screen always
 * equals the same number in the workbook. In particular `removed` and
 * `out_of_scope` are closed (they are gone), and `accepted_risk` is CAR only
 * (closed as well as CAR).
 */
export const FINDING_CAR_STATUS = "accepted_risk";

export const FINDING_OPEN_STATUSES = new Set(["open", "new", "in_progress", "not_retested"]);

export const FINDING_CLOSED_STATUSES = new Set([
  "fixed",
  "not_fixed",
  "reopened",
  FINDING_CAR_STATUS,
  "out_of_scope",
  "removed",
]);
