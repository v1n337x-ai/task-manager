/**
 * Excel value normalization (Phase 3 §34/§55).
 * The workbook mixes real date cells, d/m/yyyy serial strings ("16/6/2026"),
 * "dd MMM yy" strings ("04 Jul 26") and junk ("Pending" in a date column).
 * Everything returns either a Date or null + an exception — never silent guess.
 */
export type ExcelCell = string | number | boolean | Date | { text?: string; result?: unknown } | null | undefined;

export interface NormalizeOutcome<T> {
  value: T | null;
  warning?: string;
}

const DAYS_IN_SERIAL_EPOCH = Math.floor((new Date(1899, 11, 30)).getTime() / 86_400_000);

export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  return new Date((DAYS_IN_SERIAL_EPOCH + serial) * 86_400_000);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** ISO yyyy-mm-dd | d/m/yyyy | dd MMM yy | dd MMMM yyyy | mm-dd-yy tolerated from real workbook exports. */
export function parseDateString(input: string, ref: string): NormalizeOutcome<Date> {
  const value = input.trim();
  if (!value) return { value: null };

  // ISO / Excel ISO-ish
  const iso = Date.parse(value);
  if (!Number.isNaN(iso) && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(iso);
    if (d.getUTCFullYear() >= 2020 && d.getUTCFullYear() <= 2035) return { value: d };
  }

  // dd MMM yy | dd MMM yyyy
  const m = value.match(/^(\d{1,2})[\s-]+([a-zA-Z]{3,12})\.?[\s-]+(\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = MONTHS.findIndex((mm) => m[2]!.toLowerCase().startsWith(mm));
    let year = Number(m[3]);
    if (month < 0) return { value: null, warning: `${ref}: unparseable date "${value}".` };
    if (year < 100) year += 2000;
    if (day < 1 || day > 31 || year < 2020 || year > 2035) {
      return { value: null, warning: `${ref}: date out of program range "${value}".` };
    }
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCDate() !== day || d.getUTCMonth() !== month) {
      return { value: null, warning: `${ref}: invalid calendar date "${value}".` };
    }
    return { value: d };
  }

  // d/m/yyyy (program convention) — flag ambiguity when only one field >12.
  const dm = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dm) {
    const a = Number(dm[1]);
    const b = Number(dm[2]);
    const year = Number(dm[3]);
    if (year < 2020 || year > 2035) return { value: null, warning: `${ref}: date out of program range "${value}".` };
    if (a > 12 && b <= 12) return { value: new Date(Date.UTC(year, b - 1, a)) }; // d/m
    if (b > 12 && a <= 12) return { value: new Date(Date.UTC(year, a - 1, b)), warning: `${ref}: "${value}" reads as mm/dd though program convention is dd/mm — recorded with a warning.` };
    // Ambiguous (both ≤ 12): choose day-first deliberately and flag it.
    return {
      value: new Date(Date.UTC(year, b - 1, a)),
      warning: `${ref}: ambiguous date "${value}" interpreted as day/${monthName(b)}/${year} (program convention); confirm if month-first was intended.`,
    };
  }

  return { value: null, warning: `${ref}: unparseable date "${value}".` };
}

function monthName(m1: number): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m1 - 1] ?? "?";
}

/** Cell → Date | null (+warning). Handles Date objects, serials, strings, junk text like "Pending". */
export function normalizeCellDate(cell: ExcelCell, ref: string): NormalizeOutcome<Date> {
  if (cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "")) return { value: null };
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    // ExcelJS reads Excel dates as UTC-naive serials → carry as UTC timestamps.
    const d = new Date(Date.UTC(cell.getUTCFullYear(), cell.getUTCMonth(), cell.getUTCDate()));
    if (d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2035) return { value: null, warning: `${ref}: date out of program range.` };
    return { value: d };
  }
  if (typeof cell === "number") {
    const d = excelSerialToDate(cell);
    if (!d) return { value: null, warning: `${ref}: invalid Excel date serial.` };
    return { value: d };
  }
  if (typeof cell === "object" && cell !== null && "text" in cell && typeof (cell as { text?: unknown }).text === "string") {
    return normalizeCellDate((cell as { text: string }).text, ref);
  }
  if (typeof cell === "string") return parseDateString(cell, ref);
  return { value: null, warning: `${ref}: unsupported date cell type.` };
}

/** Cell → non-negative integer | null. Formula strings and junk produce warnings. */
export function normalizeCellInt(cell: ExcelCell, ref: string): NormalizeOutcome<number> {
  if (cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "")) return { value: null };
  if (typeof cell === "number" && Number.isInteger(cell) && cell >= 0) return { value: cell };
  if (typeof cell === "number" && Number.isFinite(cell)) {
    return { value: Math.trunc(cell), warning: `${ref}: non-integer number truncated.` };
  }
  if (typeof cell === "object" && cell !== null && !Array.isArray(cell) && !("text" in (cell as object))) {
    const result = (cell as { result?: unknown }).result;
    if (typeof result === "number" && Number.isFinite(result)) return { value: Math.trunc(result) };
    if ("formula" in (cell as object) || "shareType" in (cell as object)) return { value: null }; // uncalculated formula → blank silently
    return { value: null, warning: `${ref}: formula cell without cached result ignored.` };
  }
  const text = typeof cell === "object" && cell !== null && "text" in cell ? String((cell as { text?: unknown }).text ?? "") : typeof cell === "string" ? cell : String(cell ?? "");
  const t = text.trim();
  if (t === "") return { value: null };
  if (/^=/.test(t)) return { value: null, warning: `${ref}: formula cell treated as blank during import (importer stores only values).` };
  if (/^\d+$/.test(t)) return { value: Number(t) };
  if (/^\d+\s*\+.*$/.test(t)) {
    // Historical junk like "11+4" — sum the numeric tokens, warn loudly.
    const sum = t.split("+").map((p) => Number(p.trim())).filter((n) => !Number.isNaN(n)).reduce((a, b) => a + b, 0);
    return { value: sum, warning: `${ref}: non-numeric count "${t}" summed to ${sum}; verify against the report.` };
  }
  return { value: null, warning: `${ref}: non-numeric count "${t}" ignored.` };
}

/** Text cell extraction including rich/hyperlink objects. */
export function extractCellText(cell: ExcelCell): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "string") return cell;
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === "object" && "text" in cell) {
    const t = (cell as { text?: unknown }).text;
    return typeof t === "string" ? t : null;
  }
  return null;
}

export function cellRef(letter: string, rowNumber: number): string {
  return `VAPT tracker!${letter}${rowNumber}`;
}

export function compareBy<T>(arr: T[], selector: (x: T) => string | number): T[] {
  return [...arr].sort((a, b) => {
    const av = selector(a);
    const bv = selector(b);
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv));
  });
}
