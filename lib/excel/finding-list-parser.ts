/**
 * Finding-list workbook parser (user-requested pipeline completion).
 * Accepts workbooks shaped like the analyst's own vapt.xlsx:
 *   | # | Name of the vulnerability | Severity |
 * plus optional per-iteration status columns ("Iteration 1 Status",
 * "Iteration 2 Status", "Fixed", "Not Fixed"). This sheet format is NOT the
 * 39-column tracker contract — it is a separate accepted import artifact
 * (documented under change control) that CREATES findings in the tracker.
 * Parsing is shape-detected and honest: rows that cannot be understood are
 * skipped with a warning, never guessed.
 */
import ExcelJS from "exceljs";

export type ParsedSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ParsedFindingsRow {
  no: number;
  title: string;
  severity: ParsedSeverity;
  description: string | null;
  iteration2Status: "fixed" | "not_fixed" | null;
}

export interface FindingListParse {
  sheetName: string;
  rows: ParsedFindingsRow[];
  warnings: string[];
}

const SEV_MAP: Record<string, ParsedSeverity> = {
  critical: "critical",
  crit: "critical",
  high: "high",
  medium: "medium",
  med: "medium",
  low: "low",
  info: "info",
  informational: "info",
};

const I2_MAP: Record<string, "fixed" | "not_fixed"> = {
  fixed: "fixed",
  "has been fixed": "fixed",
  resolved: "fixed",
  "not fixed": "not_fixed",
  "still vulnerable": "not_fixed",
  reopened: "not_fixed",
};

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const v = value as unknown as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: unknown };
    if (v.richText && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v) return String(v.text ?? "").trim();
    if ("result" in v) return String(v.result ?? "").trim();
    return "";
  }
  return String(value).trim();
}

/** Find the header row + column indexes by shape detection (within row 1..10). */
function detectHeader(ws: ExcelJS.Worksheet): { row: number; noCol: number; nameCol: number; sevCol: number; i2Col: number | null } | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const row = ws.getRow(r);
    let noCol = 0, nameCol = 0, sevCol = 0, i2Col = 0;
    for (let c = 1; c <= Math.min(ws.columnCount, 30); c++) {
      const h = cellText(row.getCell(c).value).toLowerCase();
      if (!noCol && /^(#|s\.?no|no\.?|sl\.?no)$/.test(h)) noCol = c;
      if (!nameCol && /(vulnerab|finding|name|title|issue)/.test(h)) nameCol = c;
      if (!sevCol && /severit/.test(h)) sevCol = c;
      if (!i2Col && /(iteration\s*-?\s*2|iteration\s*2).*(status|verdict)|fixed\/not|status\s*\(?\s*i?2/.test(h)) i2Col = c;
    }
    if (noCol && nameCol && sevCol) return { row: r, noCol, nameCol, sevCol, i2Col: i2Col || null };
  }
  return null;
}

export async function parseFindingListWorkbook(content: Buffer): Promise<FindingListParse> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's zip loader rejects Node Buffers — hand it a real typed view.
  await wb.xlsx.load(new Uint8Array(content) as unknown as ExcelJS.Buffer);

  let parsed: FindingListParse | null = null;
  for (const ws of wb.worksheets) {
    if (ws.rowCount === 0) continue;
    const head = detectHeader(ws);
    if (!head) continue;
    const rows: ParsedFindingsRow[] = [];
    const warnings: string[] = [];

    for (let r = head.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const noRaw = cellText(row.getCell(head.noCol).value);
      const title = cellText(row.getCell(head.nameCol).value);
      const sevRaw = cellText(row.getCell(head.sevCol).value);
      const i2Raw = head.i2Col ? cellText(row.getCell(head.i2Col).value) : "";

      if (!title && !sevRaw && !noRaw) continue; // blank line
      if (!title) {
        if (noRaw && !sevRaw) continue; // stray numbering-only row — silent skip
        warnings.push(`Row ${r}: skipped — no vulnerability name.`);
        continue;
      }
      const severity = SEV_MAP[sevRaw.toLowerCase().replace(/\s+/g, " ")];
      if (!severity) {
        warnings.push(`Row ${r}: skipped — unrecognized severity "${sevRaw.slice(0, 24)}".`);
        continue;
      }
      const no = Number.parseInt(noRaw, 10) || rows.length + 1;
      let iteration2Status: ParsedFindingsRow["iteration2Status"] = null;
      if (i2Raw) {
        const mapped = I2_MAP[i2Raw.toLowerCase().replace(/\s+/g, " ")];
        if (!mapped) warnings.push(`Row ${r}: unknown Iteration-2 status "${i2Raw.slice(0, 24)}" ignored.`);
        else iteration2Status = mapped;
      }
      rows.push({ no, title: title.slice(0, 300), severity, description: null, iteration2Status });
    }

    parsed = { sheetName: ws.name, rows, warnings };
    if (rows.length > 0) break; // first sheet that yields usable rows wins
  }

  if (!parsed || parsed.rows.length === 0) {
    const detected = parsed ? parsed.sheetName : null;
    throw new Error(
      detected
        ? `No usable finding rows found in sheet "${detected}" — expected # | Name of the vulnerability | Severity columns.`
        : "No sheet with a finding-list header (# / vulnerability name / Severity) was found.",
    );
  }
  return parsed;
}

