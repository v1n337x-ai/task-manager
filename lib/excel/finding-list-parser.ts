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
  firstSeenIterationNumber: 1 | 2;
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

interface HeaderGroup {
  row: number;
  noCol: number;
  nameCol: number;
  sevCol: number;
  statusCol: number | null;
}

function groupsInRow(ws: ExcelJS.Worksheet, r: number): HeaderGroup[] {
  const row = ws.getRow(r);
  const windows = new Map<string, number>();
  for (let c = 1; c <= Math.min(ws.columnCount, 60); c++) {
    const h = cellText(row.getCell(c).value).toLowerCase().replace(/\s+/g, " ");
    if (/^(#|s\.?no|no\.?|sl\.?no)$/.test(h)) windows.set("no", c);
    if (/(vulnerab|finding|name|title|issue)/.test(h)) windows.set("name", c);
    if (/severit/.test(h)) windows.set("sev", c);
    if (/(status|verdict|iteration\s*-?\s*2|fixed\s*\/\s*not)/.test(h)) windows.set("status", c);
  }
  const no = windows.get("no");
  const name = windows.get("name");
  const sev = windows.get("sev");
  if (!no || !name || !sev) return [];
  // Build one group anchored on each "#" found. A stacked second table has
  // another "#" on a later row; a side-by-side second table has another "#"
  // on the same row. scan nearby vulnerability/severity/status columns.
  const groups: HeaderGroup[] = [];
  for (let c = 1; c <= Math.min(ws.columnCount, 60); c++) {
    const h = cellText(row.getCell(c).value).toLowerCase().replace(/\s+/g, " ");
    if (!/^(#|s\.?no|no\.?|sl\.?no)$/.test(h)) continue;
    // name = first vulnerability/name header to the right within 3 columns
    let nameC = 0;
    let sevC = 0;
    let statusC = 0;
    for (let d = c + 1; d <= Math.min(c + 5, ws.columnCount); d++) {
      const dh = cellText(row.getCell(d).value).toLowerCase().replace(/\s+/g, " ");
      if (!nameC && /(vulnerab|finding|name|title|issue)/.test(dh)) nameC = d;
      if (!sevC && /severit/.test(dh)) sevC = d;
    }
    for (let d = c + 1; d <= Math.min(c + 8, ws.columnCount); d++) {
      const dh = cellText(row.getCell(d).value).toLowerCase().replace(/\s+/g, " ");
      if (/(status|verdict|iteration\s*-?\s*2|fixed\s*\/\s*not)/.test(dh)) {
        statusC = d;
        break;
      }
    }
    if (nameC && sevC) groups.push({ row: r, noCol: c, nameCol: nameC, sevCol: sevC, statusCol: statusC || null });
  }
  return groups;
}

export async function parseFindingListWorkbook(content: Buffer): Promise<FindingListParse> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's zip loader rejects Node Buffers — hand it a real typed view.
  await wb.xlsx.load(new Uint8Array(content) as unknown as ExcelJS.Buffer);

  const normalizeTitle = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const parseRowsFromGroup = (ws: ExcelJS.Worksheet, head: HeaderGroup, start: number, end: number, warnings: string[], firstSeenIterationNumber: 1 | 2 = 1) => {
    const rows: ParsedFindingsRow[] = [];
    for (let r = start; r <= end; r++) {
      const row = ws.getRow(r);
      const noRaw = cellText(row.getCell(head.noCol).value);
      const title = cellText(row.getCell(head.nameCol).value);
      const sevRaw = cellText(row.getCell(head.sevCol).value);
      const i2Raw = head.statusCol ? cellText(row.getCell(head.statusCol).value) : "";
      if (!title && !sevRaw && !noRaw) continue;
      if (!title) {
        if (noRaw && !sevRaw) continue;
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
      rows.push({ no, title: title.slice(0, 300), severity, description: null, firstSeenIterationNumber, iteration2Status });
    }
    return rows;
  };

  let parsed: FindingListParse | null = null;
  for (const ws of wb.worksheets) {
    if (ws.rowCount === 0) continue;
    const allGroups: HeaderGroup[] = [];
    for (let r = 1; r <= ws.rowCount; r++) allGroups.push(...groupsInRow(ws, r));
    const first = allGroups[0];
    if (!first) continue;
    const warnings: string[] = [];
    const second = allGroups.find((g) => g !== first && (g.row > first.row || g.row === first.row));
    let rows: ParsedFindingsRow[] = [];

    if (!second) {
      rows = parseRowsFromGroup(ws, first, first.row + 1, ws.rowCount, warnings, 1);
    } else if (second.row === first.row) {
      const firstRows = parseRowsFromGroup(ws, first, first.row + 1, ws.rowCount, warnings, 1);
      const secondRows = parseRowsFromGroup(ws, second, second.row + 1, ws.rowCount, warnings, 2);
      rows = [...firstRows.map((row, idx) => {
        const secondRow = secondRows.find((s) => s.no === row.no) ?? secondRows.find((s) => normalizeTitle(s.title) === normalizeTitle(row.title)) ?? secondRows[idx];
        return { ...row, iteration2Status: row.iteration2Status ?? secondRow?.iteration2Status ?? null };
      }),
      ...secondRows.filter((secondRow) => !firstRows.some((row) => row.no === secondRow.no || normalizeTitle(row.title) === normalizeTitle(secondRow.title)))];
    } else {
      const firstRows = parseRowsFromGroup(ws, first, first.row + 1, second.row - 1, warnings, 1);
      const secondRows = parseRowsFromGroup(ws, second, second.row + 1, ws.rowCount, warnings, 2);
      rows = [...firstRows.map((row) => {
        const secondRow = secondRows.find((s) => s.no === row.no) ?? secondRows.find((s) => normalizeTitle(s.title) === normalizeTitle(row.title));
        return { ...row, iteration2Status: secondRow?.iteration2Status ?? null };
      }),
      ...secondRows.filter((secondRow) => !firstRows.some((row) => row.no === secondRow.no || normalizeTitle(row.title) === normalizeTitle(secondRow.title)))] ;
    }

    parsed = { sheetName: ws.name, rows, warnings };
    if (rows.length > 0) break;
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

