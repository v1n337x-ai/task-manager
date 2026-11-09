/**
 * Master multi-app tracker parser ("PT Tracker 26-27.xlsx") — Phase M2.
 * Reads the 'VAPT tracker' overview sheet (the user's authoritative summary)
 * and normalizes it to per-application rows: engagement metadata, iteration
 * dates/statuses, comments/follow-ups and the aggregate severity counts
 * (per-severity totals 21-25, CAR 26, Total 27, Pending 28, Closed 29 and the
 * Open/Closed matrix at AE..AN = cols 31..40).
 *
 * SEMANTICS learned from the real workbook (verified reconciliation on every
 * 2026 row): per-severity Total_i = Open_i + Closed_i + CAR_i; the master
 * carries CAR only at app level (col 26) and its per-severity split is
 * reconstructed as max(0, Total_i - Open_i - Closed_i).
 *
 * This parser NEVER writes — import goes through master-tracker-import-service.
 */
import ExcelJS from "exceljs";

export interface MasterSeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface MasterTrackerRow {
  sNo: number | null;
  application: string;
  target: string | null;
  mailSubject: string | null;
  sourceTool: string | null;
  pocText: string | null;
  assignedText: string | null;
  overallStatus: string | null;
  totalVulnCount: number | null;
  scanDate: Date | null;
  requestedDate: Date | null;
  iteration1Date: Date | null;
  iteration1Status: string | null;
  iteration2Date: Date | null;
  iteration2Status: string | null; // set when the date cell carries "Pending" etc.
  comments: string | null;
  followUpDate: Date | null;
  followUpResponse: string | null;
  severityTotals: MasterSeverityCounts;
  car: number;
  total: number;
  pending: number;
  closed: number;
  openBySeverity: MasterSeverityCounts;
  closedBySeverity: MasterSeverityCounts;
  carBySeverity: MasterSeverityCounts;
}

export interface MasterTrackerParseResult {
  sheetName: string;
  rows: MasterTrackerRow[];
  warnings: string[];
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

/** Header (row 2 of the user's sheet) → normalized key → column number. */
function normalizedHeader(v: ExcelJS.CellValue): string {
  const raw = cellText(v);
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof (v as { text?: unknown }).text === "string") return String((v as { text: string }).text);
    if ("result" in v && (v as { result?: unknown }).result !== undefined) return String((v as { result: unknown }).result);
    if ("error" in v) return "";
    if ("formula" in v) return ""; // grand-total formulas are never data
    return String(v);
  }
  return String(v);
}

function cellNumber(v: ExcelJS.CellValue): number | null {
  const t = cellText(v).trim();
  if (!t) return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function cellDate(v: ExcelJS.CellValue): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  // Excel serial number (ExcelJS returns Date objects for real dates, but
  // be tolerant to serials)
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const t = cellText(v).trim();
  if (!t) return null;
  // ISO serializations left as text
  const iso = /^(\d{4})-(\d{2})-(\d{2})T/.exec(t);
  if (iso) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  // dd/mm/yyyy (the user's dominant format)
  const dd = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (dd) {
    const day = Number(dd[1]);
    const month = Number(dd[2]);
    const year = Number(dd[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return new Date(year, month - 1, day);
  }
  return null; // non-date strings ("Pending", prose) handled by the caller
}

/** A date cell that actually carries a status word ("Pending") → status text. */
function cellDateOrStatus(v: ExcelJS.CellValue): { date: Date | null; status: string | null } {
  const date = cellDate(v);
  if (date) return { date, status: null };
  const t = cellText(v).trim();
  if (t && !t.startsWith("=") && t.length <= 30) return { date: null, status: t };
  return { date: null, status: null };
}

const zeroCounts = (): MasterSeverityCounts => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
const order = SEVERITY_ORDER as unknown as string[];
const byIndex = (i: number) => order[i]!;

export async function parseMasterTrackerWorkbook(input: Buffer | Uint8Array): Promise<MasterTrackerParseResult> {
  const wb = new ExcelJS.Workbook();
  // Same ExcelJS fix as the finding-list parser (zip loader rejects Buffers).
  await wb.xlsx.load(new Uint8Array(input) as unknown as ExcelJS.Buffer);

  const ws = wb.worksheets.find((s) => s.name.toLowerCase().trim() === "vapt tracker");
  if (!ws) throw new Error("Master tracker workbook has no 'VAPT tracker' sheet.");

  // ---- locate the header row (contains "S.no") ----
  let headerRowNumber = 0;
  const headerMap = new Map<string, number>();
  let matrixCols: Record<string, number> | null = null;
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const labels = new Map<string, number>();
    for (let c = 1; c <= row.cellCount; c++) {
      const n = normalizedHeader(row.getCell(c).value);
      if (n && !labels.has(n)) labels.set(n, c);
    }
    if (labels.has("s.no") && labels.has("application")) {
      headerRowNumber = r;
      for (const [name, c] of labels.entries()) headerMap.set(name, c);

      // Open/Closed matrix band: the header row carries "Open"/"Closed" labels
      // while the band row ABOVE carries the severity names (merged band).
      // Find the first "Open" whose overlay severity is "critical", then take
      // the ten following columns (open/closed × critical..info).
      for (let c = 1; c < row.cellCount; c++) {
        if (normalizedHeader(row.getCell(c).value) !== "open") continue;
        const above = r > 1 ? ws.getRow(r - 1) : null;
        if (above && normalizedHeader(above.getCell(c).value) === "critical") {
          const expect = ["open", "closed", "open", "closed", "open", "closed", "open", "closed", "open", "closed"];
          const aboveExpect = ["critical", "critical", "high", "high", "medium", "medium", "low", "low", "info", "info"];
          let ok = true;
          for (let i = 0; i < 10; i++) {
            const cellNorm = normalizedHeader(ws.getRow(r).getCell(c + i).value);
            const aboveNorm = above ? normalizedHeader(above.getCell(c + i).value) : "";
            if (i > 0 && (cellNorm !== expect[i] || aboveNorm !== aboveExpect[i])) { ok = false; break; }
          }
          if (ok) {
            matrixCols = {};
            for (let i = 0; i < 10; i++) {
              const sev = byIndex(Math.floor(i / 2));
              matrixCols[`${sev}_${i % 2 === 0 ? "open" : "closed"}`] = c + i;
            }
            break;
          }
        }
      }
      break;
    }
  }
  if (!headerRowNumber || !matrixCols) {
    throw new Error("'VAPT tracker' sheet does not carry the expected header row (S.no / Application).");
  }

  const col = (name: string): number => {
    const c = headerMap.get(name);
    if (!c) throw new Error(`Master tracker header from '${name}' not found.`);
    return c;
  };

  const rows: MasterTrackerRow[] = [];
  const warnings: string[] = [];

  for (let r = headerRowNumber + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const app = cellText(row.getCell(col("application")).value).trim();
    if (!app) continue; // blank spacer rows & the grand-total line (R33 style)
    const sNo = cellNumber(row.getCell(col("s.no")).value);
    if (sNo === null) continue; // rows without S.no are total rows, never data

    const i1 = cellDateOrStatus(row.getCell(col("iteration - 1 date")).value);
    const i2 = cellDateOrStatus(row.getCell(col("iteration-2 date")).value);

    const severityTotals = zeroCounts();
    severityTotals.critical = cellNumber(row.getCell(col("critical")).value) ?? 0;
    severityTotals.high = cellNumber(row.getCell(col("high")).value) ?? 0;
    severityTotals.medium = cellNumber(row.getCell(col("medium")).value) ?? 0;
    severityTotals.low = cellNumber(row.getCell(col("low")).value) ?? 0;
    severityTotals.info = cellNumber(row.getCell(col("info")).value) ?? 0;

    const rowTotal = cellNumber(row.getCell(col("total")).value);
    const declaredTotal = rowTotal ?? Object.values(severityTotals).reduce((a, b) => a + b, 0);

    const openBySeverity = zeroCounts();
    const closedBySeverity = zeroCounts();
    let matrixValid = declaredTotal > 0;
    for (let i = 0; i < 5; i++) {
      const sev = byIndex(i);
      const o = cellNumber(row.getCell(matrixCols[`${sev}_open`]!).value) ?? 0;
      const c = cellNumber(row.getCell(matrixCols[`${sev}_closed`]!).value) ?? 0;
      // sanity: the matrix of any app cannot exceed its declared total
      if (o + c > declaredTotal) matrixValid = false;
      openBySeverity[sev as keyof MasterSeverityCounts] = o;
      closedBySeverity[sev as keyof MasterSeverityCounts] = c;
    }
    if (!matrixValid) {
      openBySeverity.critical = openBySeverity.high = openBySeverity.medium = openBySeverity.low = openBySeverity.info = 0;
      closedBySeverity.critical = closedBySeverity.high = closedBySeverity.medium = closedBySeverity.low = closedBySeverity.info = 0;
      warnings.push(`row ${sNo} (${app}): Open/Closed matrix ignored (values exceed the declared total).`);
    }

    const carBySeverity = zeroCounts();
    for (const sev of order) {
      const t = severityTotals[sev as keyof MasterSeverityCounts] ?? 0;
      const used = openBySeverity[sev as keyof MasterSeverityCounts] + closedBySeverity[sev as keyof MasterSeverityCounts];
      carBySeverity[sev as keyof MasterSeverityCounts] = Math.max(0, t - used);
    }

    const masterCar = cellNumber(row.getCell(col("car")).value) ?? 0;
    const reconCar = order.reduce((a, s) => a + carBySeverity[s as keyof MasterSeverityCounts], 0);
    if (masterCar > 0 && reconCar === 0) {
      // Master keeps CAR at app level without matrix support — book it to Medium.
      warnings.push(`row ${sNo} (${app}): CAR ${masterCar} declared but the Open/Closed matrix is complete; keeping app-level CAR value.`);
    }

    rows.push({
      sNo,
      application: app,
      target: cellText(row.getCell(col("web url/api/fqdn")).value).trim() || null,
      mailSubject: cellText(row.getCell(col("mail subject")).value).trim() || null,
      sourceTool: cellText(row.getCell(col("source / tool")).value).trim() || null,
      pocText: cellText(row.getCell(col("poc akasa air")).value).trim() || null,
      assignedText: cellText(row.getCell(col("digialert team - assigned member")).value).trim() || null,
      overallStatus: normalizedHeader(row.getCell(col("overall status")).value) || null,
      totalVulnCount: cellNumber(row.getCell(col("total vuln count")).value),
      scanDate: cellDate(row.getCell(col("scan/report date")).value),
      requestedDate: cellDate(row.getCell(col("requested date")).value),
      iteration1Date: i1.date,
      iteration1Status: (cellText(row.getCell(col("iteration - 1 status")).value).trim() || i1.status) || null,
      iteration2Date: i2.date,
      iteration2Status: (cellText(row.getCell(col("iteration - 2 status")).value).trim() || i2.status) || null,
      comments: cellText(row.getCell(col("comments")).value).trim() || null,
      followUpDate: cellDate(row.getCell(col("follow-up")).value),
      followUpResponse: cellText(row.getCell(col("follow-up response")).value).trim() || null,
      severityTotals,
      car: masterCar,
      total: declaredTotal,
      pending: cellNumber(row.getCell(col("pending")).value) ?? 0,
      closed: cellNumber(row.getCell(col("vulnerabilities closed")).value) ?? 0,
      openBySeverity,
      closedBySeverity,
      carBySeverity,
    });
  }

  return { sheetName: ws.name, rows, warnings: warnings as string[] };
}
