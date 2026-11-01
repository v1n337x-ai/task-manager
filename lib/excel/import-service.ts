/**
 * PT Tracker v1.0 Excel import engine (Phase 3 §25-§36, §51-§55).
 *
 * Pipeline (§25): Upload → Validate workbook/sheet/columns/rows → Preview →
 * Confirm → Transactional persist. Validate NEVER writes business data; it
 * stores the normalized preview on the ImportJob (§29) for the confirm step.
 *
 * Contract (§27): headers compared EXACTLY (trailing spaces included) against
 * the bundled contract + stored SchemaVersion. Non-match ⇒ INVALID_EXCEL_SCHEMA.
 */
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import {
  TRACKER_COLUMNS,
  TRACKED_CONTRACT_COLUMNS,
  TRACKER_SHEET,
  HEADER_ROW,
  DATA_START_ROW,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  CONTRACT_COLUMNS_COUNT,
  canonicalizeColumnValue,
} from "./contract";
import {
  cellRef,
  extractCellText,
  normalizeCellDate,
  normalizeCellInt,
  type ExcelCell,
} from "./normalize";

export interface TrackerRow {
  rowNumber: number;
  sNo: number | null;
  applicationRaw: string;
  applicationNormalized: string;
  scopeValue: string | null;
  targetRaw: string | null;
  webUrl: string | null;
  apiFqdn: string | null;
  mailSubject: string | null;
  typeValue: string;
  typeRaw: string;
  assessmentSourceValue: string;
  assessmentSourceRaw: string;
  pocRaw: string | null;
  assignedRaw: string | null;
  overallStatusValue: string;
  overallStatusRaw: string;
  totalVulnCount: number | null;
  scanReportDate: Date | null;
  requestedDate: Date | null;
  iteration1Date: Date | null;
  iteration1StatusValue: string | null;
  iteration2Date: Date | null;
  iteration2StatusValue: string | null;
  comments: string | null;
  followUpDate: Date | null;
  followUpResponse: string | null;
  counts: TrackerCounts;
  matrix: TrackerMatrix;
}

export interface TrackerCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  car: number;
  total: number;
  pending: number;
  closed: number;
}

export interface TrackerMatrix {
  criticalOpen: number;
  criticalClosed: number;
  highOpen: number;
  highClosed: number;
  mediumOpen: number;
  mediumClosed: number;
  lowOpen: number;
  lowClosed: number;
  infoOpen: number;
  infoClosed: number;
}

export interface ImportException {
  severity: "error" | "warning";
  row?: number;
  ref?: string;
  code: string;
  message: string;
}

export interface WorkbookValidation {
  ok: boolean;
  exceptions: ImportException[];
  rows: TrackerRow[];
  blankRowsSkipped: number;
  identityWarnings: number;
}

// ---------------------------------------------------------------------------
// Header contract (§27) — exact strings, order fixed, blanks tolerated.
// ---------------------------------------------------------------------------
export function compareHeaderCells(headerRowValues: Record<number, ExcelCell>): {
  matches: boolean;
  mismatches: { letter: string; expected: string | null; actual: string | null }[];
} {
  const mismatches: { letter: string; expected: string | null; actual: string | null }[] = [];
  for (const col of TRACKER_COLUMNS) {
    const actual = extractCellText(headerRowValues[col.index] ?? null);
    const expected = col.header;
    if (expected === null) {
      if (actual !== null && actual.trim() !== "") mismatches.push({ letter: col.letter, expected: "<blank>", actual });
      continue;
    }
    if (actual !== expected) mismatches.push({ letter: col.letter, expected, actual });
  }
  return { matches: mismatches.length === 0, mismatches };
}

// ---------------------------------------------------------------------------
// Row parser (§26/§34/§55) — normalization with explicit warnings, no silent fixes.
// ---------------------------------------------------------------------------
export function parseTrackerRows(collected: { rowNumber: number; cells: Record<number, ExcelCell> }[]): { validation: WorkbookValidation } {
  const exceptions: ImportException[] = [];
  const rows: TrackerRow[] = [];
  let blankRowsSkipped = 0;
  let identityWarnings = 0;

  for (const { rowNumber, cells } of collected) {
    const ref = (idx: number) => cellRef(contractLetter(idx), rowNumber);

    const applicationRaw = extractCellText(cells[2] ?? null)?.trim() ?? "";
    if (!applicationRaw) {
      blankRowsSkipped += 1;
      continue;
    }
    const applicationNormalized = applicationRaw.toLowerCase().replace(/\s+/g, " ").trim();
    // NBSP (\u00a0) and friends count as whitespace via \s — matching folds them.

    // Template-junk skip FIRST (§26 §11): an application record carries at least
    // one LITERAL data signal (status/date/counts/matrix). Formula cells are
    // derived aggregates and must never count as row signals — the template's
    // totals row (with CACHED results) must not import as an application.
    const overallProbe = canonicalizeColumnValue(TRACKER_COLUMNS[9]!, extractCellText(cells[10] ?? "") ?? "");
    const scanProbe = normalizeCellDate(cells[12] ?? null, ref(12));
    const literalSignalCount = [
      ...[21, 22, 23, 24, 25, 26, 27, 28, 29],
      ...[31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
    ].filter((idx) => {
      const cell = cells[idx] ?? null;
      if (cell === null || cell === undefined) return false;
      if (typeof cell === "object" && !Array.isArray(cell) && ("formula" in (cell as object) || "shareType" in (cell as object))) return false;
      const v = typeof cell === "object" && "result" in (cell as object) ? (cell as { result?: unknown }).result : cell;
      return typeof v === "number" && v !== 0;
    }).length;
    const extraSignalDates =
      normalizeCellDate(cells[13] ?? null, ref(13)).value ||
      normalizeCellDate(cells[14] ?? null, ref(14)).value ||
      normalizeCellDate(cells[16] ?? null, ref(16)).value ||
      normalizeCellDate(cells[19] ?? null, ref(19)).value;
    // §26: unrecognized TEXT CONTENT is a signal (it must surface as an error
    // row); only genuinely EMPTY columns count as absent. Any non-blank text
    // in scope/type/source/status/date-ish text columns marks an application.
    const textSignal = [3, 6, 7, 10, 15, 17].some((idx) => (extractCellText(cells[idx] ?? "")?.trim() ?? "") !== "");
    const hasDataSignals =
      overallProbe.value ||
      scanProbe.value ||
      extraSignalDates ||
      textSignal ||
      literalSignalCount > 0;
    if (!hasDataSignals) {
      blankRowsSkipped += 1;
      exceptions.push({
        severity: "warning",
        row: rowNumber,
        code: "ROW_SKIPPED",
        message: `Row ${rowNumber}: "${applicationRaw}" carries no application data signals — skipped as a template artifact.`,
      });
      continue;
    }

    // C — scope
    const scope = canonicalizeColumnValue(TRACKER_COLUMNS[2]!, extractCellText(cells[3] ?? "") ?? "");
    if (!scope.value) {
      exceptions.push({ severity: "error", row: rowNumber, ref: ref(3), code: "INVALID_SCOPE", message: `Row ${rowNumber} ${applicationRaw}: ${scope.warning ?? "invalid scope."}` });
    }

    // D — target (web URL | FQDN | other)
    const targetCell = extractCellText(cells[4] ?? null);
    let webUrl: string | null = null;
    let apiFqdn: string | null = null;
    let targetRaw: string | null = null;
    if (targetCell && targetCell.trim()) {
      const t = targetCell.trim();
      if (/^https?:\/\//i.test(t)) webUrl = t.replace(/\s+$/, "");
      else if (/^[a-z0-9.\-]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) apiFqdn = t;
      else targetRaw = t;
    }

    // F — type / G — source / J — overall status
    const type = canonicalizeColumnValue(TRACKER_COLUMNS[5]!, extractCellText(cells[6] ?? "") ?? "");
    const source = canonicalizeColumnValue(TRACKER_COLUMNS[6]!, extractCellText(cells[7] ?? "") ?? "");
    const overall = overallProbe;
    if (!source.value) {
      exceptions.push({ severity: "error", row: rowNumber, ref: ref(7), code: "INVALID_SOURCE", message: `Row ${rowNumber} ${applicationRaw}: ${source.warning ?? "invalid source."}` });
    }
    if (!overall.value) {
      exceptions.push({ severity: "error", row: rowNumber, ref: ref(10), code: "INVALID_STATUS", message: `Row ${rowNumber} ${applicationRaw}: ${overall.warning ?? "invalid overall status."}` });
    }

    // L — Scan/Report Date: blank ⇒ warning (newly-initiated apps legitimately
    // have none yet, §34); unparseable CONTENT ⇒ error (first 26 invalid dates).
    const scanDateCell = cells[12] ?? null;
    const scanDateText = extractCellText(scanDateCell)?.trim() ?? "";
    const scanDate = normalizeCellDate(scanDateCell, ref(12));
    if (!scanDate.value) {
      if (scanDateText !== "") {
        exceptions.push({ severity: "error", row: rowNumber, ref: ref(12), code: "INVALID_DATE", message: `Row ${rowNumber} ${applicationRaw}: ${scanDate.warning ?? "Scan/Report Date is invalid."}` });
      } else {
        exceptions.push({ severity: "warning", row: rowNumber, code: "DATE_MISSING", message: `Row ${rowNumber} ${applicationRaw}: Scan/Report Date is blank (application not yet reported). Stored as null.` });
      }
    }
    const requested = normalizeCellDate(cells[13] ?? null, ref(13));
    const iter1Date = normalizeCellDate(cells[14] ?? null, ref(14));
    const iter1Status = canonicalizeColumnValue(TRACKER_COLUMNS[14]!, extractCellText(cells[15] ?? "") ?? "");
    const iter2Date = normalizeCellDate(cells[16] ?? null, ref(16));
    const iter2Status = canonicalizeColumnValue(TRACKER_COLUMNS[16]!, extractCellText(cells[17] ?? "") ?? "");
    for (const res of [requested, iter1Date, iter2Date]) {
      if (!res.value && res.warning) {
        exceptions.push({ severity: "warning", row: rowNumber, code: "DATE_WARNING", message: res.warning });
      }
    }

    const comments = extractCellText(cells[18] ?? null);
    const followUp = normalizeCellDate(cells[19] ?? null, ref(19));
    if (!followUp.value && followUp.warning) {
      exceptions.push({ severity: "warning", row: rowNumber, code: "DATE_WARNING", message: followUp.warning });
    }
    const followUpResponse = extractCellText(cells[20] ?? null);

    // U..AC counts
    const countKeys: (keyof TrackerCounts)[] = ["critical", "high", "medium", "low", "info", "car", "total", "pending", "closed"];
    const countIdx = [21, 22, 23, 24, 25, 26, 27, 28, 29];
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, car: 0, total: 0, pending: 0, closed: 0 } as TrackerCounts;
    countIdx.forEach((idx, i) => {
      const key = countKeys[i]!;
      const res = normalizeCellInt(cells[idx] ?? null, ref(idx));
      counts[key] = res.value ?? 0;
      if (!res.value && res.warning) exceptions.push({ severity: "warning", row: rowNumber, code: "COUNT_WARNING", message: res.warning });
    });

    // Identity (§36): Total = Pending + Closed + CAR — warning recorded, never auto-fixed.
    const identitySum = counts.pending + counts.closed + counts.car;
    const countsSeen = counts.total + counts.pending + counts.closed + counts.car;
    if (countsSeen > 0 && identitySum !== counts.total) {
      identityWarnings += 1;
      exceptions.push({
        severity: "warning",
        row: rowNumber,
        code: "TOTAL_IDENTITY_MISMATCH",
        message: `${applicationRaw}: Total(${counts.total}) ≠ Pending(${counts.pending}) + Closed(${counts.closed}) + CAR(${counts.car}). Snapshot keeps source values; live counts derive from findings.`,
      });
    }

    // AE..AN matrix (formula cells in totals rows tolerated as blank)
    const matrixIndexes = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
    const matrixValues = matrixIndexes.map((idx) => {
      const raw = cells[idx] ?? null;
      const res = normalizeCellInt(raw, ref(idx));
      if (!res.value && res.warning && !/^=/.test(String(raw ?? ""))) {
        exceptions.push({ severity: "warning", row: rowNumber, code: "MATRIX_WARNING", message: res.warning });
      }
      return res.value ?? 0;
    });
    const matrix: TrackerMatrix = {
      criticalOpen: matrixValues[0]!,
      criticalClosed: matrixValues[1]!,
      highOpen: matrixValues[2]!,
      highClosed: matrixValues[3]!,
      mediumOpen: matrixValues[4]!,
      mediumClosed: matrixValues[5]!,
      lowOpen: matrixValues[6]!,
      lowClosed: matrixValues[7]!,
      infoOpen: matrixValues[8]!,
      infoClosed: matrixValues[9]!,
    };

    const sNo = normalizeCellInt(cells[1] ?? null, ref(1));

    // Skip template-junk rows: an application record carries at least one data
    // signal (status / date / counts / matrix). Rows with none (e.g. the
    // template's stray label row) are skipped with a warning, never imported.
    const matrixAllZero = Object.values(matrix).every((v) => v === 0);
    const countsAllZero = Object.values(counts).every((v) => v === 0);
    const dataSignals =
      overall.value ||
      scanDate.value ||
      requested.value ||
      iter1Date.value ||
      iter2Date.value ||
      !countsAllZero ||
      !matrixAllZero;
    if (!dataSignals) {
      blankRowsSkipped += 1;
      exceptions.push({
        severity: "warning",
        row: rowNumber,
        code: "ROW_SKIPPED",
        message: `Row ${rowNumber}: "${applicationRaw}" carries no application data signals — skipped as a template artifact.`,
      });
      continue;
    }

    rows.push({
      rowNumber,
      sNo: sNo.value,
      applicationRaw,
      applicationNormalized,
      scopeValue: scope.value,
      targetRaw,
      webUrl,
      apiFqdn,
      mailSubject: extractCellText(cells[5] ?? null)?.trim() || null,
      typeValue: type.value ?? "other",
      typeRaw: extractCellText(cells[6] ?? "") ?? "",
      assessmentSourceValue: source.value ?? "other",
      assessmentSourceRaw: extractCellText(cells[7] ?? "") ?? "",
      pocRaw: extractCellText(cells[8] ?? null)?.trim() || null,
      assignedRaw: extractCellText(cells[9] ?? null)?.trim() || null,
      overallStatusValue: overall.value ?? "",
      overallStatusRaw: extractCellText(cells[10] ?? "") ?? "",
      totalVulnCount: normalizeCellInt(cells[11] ?? null, ref(11)).value,
      scanReportDate: scanDate.value,
      requestedDate: requested.value,
      iteration1Date: iter1Date.value,
      iteration1StatusValue: iter1Status.value,
      iteration2Date: iter2Date.value,
      iteration2StatusValue: iter2Status.value,
      comments,
      followUpDate: followUp.value,
      followUpResponse,
      counts,
      matrix,
    });
  }

  const errors = exceptions.filter((e) => e.severity === "error");
  return {
    validation: {
      ok: errors.length === 0 && rows.length > 0,
      exceptions,
      rows,
      blankRowsSkipped,
      identityWarnings,
    },
  };
}

function contractLetter(excelColumn: number): string {
  return TRACKER_COLUMNS.find((c) => c.index === excelColumn)?.letter ?? `col${excelColumn}`;
}

/** Reader collects structured rows; parser walks them. */

// ---------------------------------------------------------------------------
// Job lifecycle (§29-§30)
// ---------------------------------------------------------------------------

async function loadSchemaVersion() {
  const sv = await prisma.schemaVersion.findUnique({
    where: { trackerName_version: { trackerName: SCHEMA_NAME, version: SCHEMA_VERSION } },
  });
  if (!sv) throw new AppError("INTERNAL_ERROR", 500, "PT Tracker schema contract is missing — run the seed.");
  if (sv.columnsCount !== CONTRACT_COLUMNS_COUNT) {
    throw new AppError("INVALID_EXCEL_SCHEMA", 422, `PT Tracker v1.0 expects ${CONTRACT_COLUMNS_COUNT} tracked columns (stored contract has ${sv.columnsCount}).`);
  }
  return sv;
}

export interface ApplicationMapping {
  applicationRaw: string;
  matched: "exact" | "alias" | "willCreate" | "unresolved";
  applicationId: number | null;
}

export interface ImportPreviewSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warnings: number;
  applicationsMap: ApplicationMapping[];
  willCreateApplications: number;
  willUpdateApplications: number;
  newEngagements: number;
  newIterations: number;
  snapshotsUpdated: number;
  duplicateSNo: string[];
  iterationDetected: string;
  removedTestCasesExpected: number;
  identityWarnings: number;
}

async function jobCompleted(jobId: number): Promise<boolean> {
  const j = await prisma.importJob.findUnique({ where: { id: jobId }, select: { statusRef: { select: { value: true } } } });
  return j?.statusRef.value === "completed" || j?.statusRef.value === "completed_with_warnings";
}

function serializeRows(rows: TrackerRow[]): TrackerRowSerialized[] {
  return rows.map((r) => ({
    ...r,
    scanReportDate: r.scanReportDate?.toISOString() ?? null,
    requestedDate: r.requestedDate?.toISOString() ?? null,
    iteration1Date: r.iteration1Date?.toISOString() ?? null,
    iteration2Date: r.iteration2Date?.toISOString() ?? null,
    followUpDate: r.followUpDate?.toISOString() ?? null,
  }));
}

export interface TrackerRowSerialized extends Omit<TrackerRow, "scanReportDate" | "requestedDate" | "iteration1Date" | "iteration2Date" | "followUpDate"> {
  scanReportDate: string | null;
  requestedDate: string | null;
  iteration1Date: string | null;
  iteration2Date: string | null;
  followUpDate: string | null;
}

/** §25/§26/§29: validate ONLY; the job stores preview + summary. */
export async function validateImport(params: {
  filename: string;
  mimeType?: string | null;
  content: Buffer;
  userId: number;
  options?: { createMissingApplications?: boolean; force?: boolean };
  ctx: { ip?: string; userAgent?: string };
  createSha256Fn: (content: Buffer) => string;
}): Promise<{ jobId: number; validation: WorkbookValidation; preview: ImportPreviewSummary; alreadyImported?: boolean }> {
  const sha = params.createSha256Fn(params.content);

  // §52 idempotency — same file already completed → skip (unless force).
  const existing = await prisma.importJob.findUnique({ where: { sha256: sha } });
  if (existing && !params.options?.force && (await jobCompleted(existing.id))) {
    const summary = (existing.summary ?? {}) as unknown as ImportPreviewSummary | null;
    await recordAudit({
      action: "excel_import.idempotent_skip",
      entityType: "ImportJob",
      entityId: existing.id,
      newValue: JSON.stringify({ filename: params.filename, reason: "file already imported" }),
      source: "SYSTEM",
      actorUserId: params.userId,
    });
    return {
      jobId: existing.id,
      validation: { ok: true, exceptions: [], rows: [], blankRowsSkipped: 0, identityWarnings: 0 },
      preview:
        summary ??
        ({
          totalRows: 0,
          validRows: 0,
          errorRows: 0,
          warnings: 0,
          applicationsMap: [],
          willCreateApplications: 0,
          willUpdateApplications: 0,
          newEngagements: 0,
          newIterations: 0,
          snapshotsUpdated: 0,
          duplicateSNo: [],
          iterationDetected: "File already imported previously (idempotent skip).",
          removedTestCasesExpected: 0,
          identityWarnings: 0,
        } satisfies ImportPreviewSummary),
      alreadyImported: true,
    };
  }

  const sv = await loadSchemaVersion();

  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(params.content as unknown as ExcelJS.Buffer);
  } catch {
    throw new AppError("INVALID_EXCEL_SCHEMA", 422, "The uploaded file is not a readable Excel workbook.");
  }
  const sheet = workbook.worksheets.find((ws) => ws.name === TRACKER_SHEET);
  if (!sheet) throw new AppError("INVALID_EXCEL_SCHEMA", 422, `Required sheet "${TRACKER_SHEET}" is missing.`);

  const headerRowValues: Record<number, ExcelCell> = {};
  for (const col of TRACKER_COLUMNS) {
    headerRowValues[col.index] = sheet.getRow(HEADER_ROW).getCell(col.index).value as unknown as ExcelCell;
  }
  const headerResult = compareHeaderCells(headerRowValues);
  if (!headerResult.matches) {
    const mismatchSummary = headerResult.mismatches
      .slice(0, 6)
      .map((m) => `${m.letter}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
      .join("; ");
    throw new AppError(
      "INVALID_EXCEL_SCHEMA",
      422,
      `The uploaded workbook does not match ${SCHEMA_NAME} v${SCHEMA_VERSION}. ${mismatchSummary}`,
    );
  }

  // Collect data rows until two consecutive blank Application cells.
  const collected: { rowNumber: number; cells: Record<number, ExcelCell> }[] = [];
  let blanks = 0;
  const maxRow = Math.min(sheet.rowCount, 500);
  for (let r = DATA_START_ROW; r <= maxRow; r++) {
    const row = sheet.getRow(r);
    const b = extractCellText(row.getCell(2).value as unknown as ExcelCell)?.trim() ?? "";
    if (!b) {
      blanks += 1;
      if (blanks >= 2) break;
      continue;
    }
    blanks = 0;
    const rowData: Record<number, ExcelCell> = {};
    for (const col of TRACKED_CONTRACT_COLUMNS) rowData[col.index] = row.getCell(col.index).value as unknown as ExcelCell;
    collected.push({ rowNumber: r, cells: rowData });
  }

  const { validation } = parseTrackerRows(collected);

  // §53 application matching preview — exact → alias → (optional create) else unresolved.
  const apps = await prisma.application.findMany({ include: { aliases: true } });
  const byExactName = new Map(apps.map((a) => [a.name.toLowerCase().replace(/\s+/g, " ").trim(), a]));
  const byAlias = new Map<string, string>(); // normalized alias -> applicationId
  for (const app of apps) {
    for (const alias of app.aliases) {
      byAlias.set(alias.normalized, app.id.toString());
    }
  }
  const createMissing = params.options?.createMissingApplications ?? false;
  const mapping: ApplicationMapping[] = validation.rows.map((row) => {
    const exact = byExactName.get(row.applicationNormalized);
    if (exact) return { applicationRaw: row.applicationRaw, matched: "exact", applicationId: exact.id };
    const aliasHit = byAlias.get(row.applicationNormalized);
    if (aliasHit) return { applicationRaw: row.applicationRaw, matched: "alias", applicationId: Number(aliasHit) };
    if (createMissing) return { applicationRaw: row.applicationRaw, matched: "willCreate", applicationId: null };
    return { applicationRaw: row.applicationRaw, matched: "unresolved", applicationId: null };
  });

  const summary: ImportPreviewSummary = {
    totalRows: validation.rows.length,
    validRows: validation.rows.filter((r) => r.overallStatusValue && r.scopeValue && r.scanReportDate).length,
    errorRows: validation.exceptions.filter((e) => e.severity === "error").length,
    warnings: validation.exceptions.filter((e) => e.severity === "warning").length,
    applicationsMap: mapping,
    willCreateApplications: mapping.filter((m) => m.matched === "willCreate").length,
    willUpdateApplications: mapping.filter((m) => m.matched === "exact" || m.matched === "alias").length,
    newEngagements: validation.rows.length,
    newIterations: validation.rows.reduce((acc, r) => acc + (r.iteration2StatusValue ? 2 : 1), 0),
    snapshotsUpdated: 0,
    duplicateSNo: (() => {
      const seen = new Set<string>();
      const dups = new Set<string>();
      for (const r of validation.rows) {
        if (r.sNo === null) continue;
        if (seen.has(String(r.sNo))) dups.add(String(r.sNo));
        seen.add(String(r.sNo));
      }
      return [...dups];
    })(),
    iterationDetected: validation.rows.some((r) => r.iteration2StatusValue)
      ? "Iteration 2 (Retest) detected via Iteration-2 Status column. Iteration 3+ cannot be derived from the v1 contract."
      : "Iteration 1 — Initial Scan only.",
    removedTestCasesExpected: 0,
    identityWarnings: validation.identityWarnings,
  };

  const jobStatusValue = validation.ok ? "ready" : summary.validRows === 0 && summary.totalRows === 0 ? "failed" : "ready";
  const statusId = (await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: jobStatusValue } } }))?.id;
  if (!statusId) throw NotFoundError(`job_status/${jobStatusValue}`);

  const job = await prisma.importJob.upsert({
    where: { sha256: sha },
    // Existing non-completed job (failed/validating) is reused — sha is unique (§52).
    update: {
      filename: params.filename,
      mimeType: params.mimeType ?? null,
      schemaVersionId: sv.id,
      status: statusId,
      options: (params.options ?? undefined) as never,
      preview: { exceptions: validation.exceptions, rows: serializeRows(validation.rows), mapping } as never,
      summary: summary as never,
      rowsProcessed: summary.validRows,
      rowsFailed: summary.errorRows,
      warningCount: summary.warnings,
      errorCount: 0,
      startedAt: new Date(),
      completedAt: null,
      createdByUserId: params.userId,
    },
    create: {
      filename: params.filename,
      mimeType: params.mimeType ?? null,
      sha256: sha,
      type: "xlsx_tracker",
      schemaVersionId: sv.id,
      status: statusId,
      options: (params.options ?? undefined) as never,
      preview: { exceptions: validation.exceptions, rows: serializeRows(validation.rows), mapping } as never,
      summary: summary as never,
      rowsProcessed: summary.validRows,
      rowsFailed: summary.errorRows,
      warningCount: summary.warnings,
      startedAt: new Date(),
      createdByUserId: params.userId,
    },
  });

  await recordAudit({
    action: validation.ok ? "excel_import.validated" : "excel_import.rejected",
    entityType: "ImportJob",
    entityId: job.id,
    newValue: JSON.stringify({ filename: params.filename, rows: summary.totalRows, warnings: summary.warnings, errors: summary.errorRows }),
    source: "HUMAN",
    actorUserId: params.userId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });

  return { jobId: job.id, validation, preview: summary };
}

// ---------------------------------------------------------------------------
// Confirm (§51) — one transaction; rollback marks the job failed.
// ---------------------------------------------------------------------------

export async function confirmImport(jobId: number, userId: number, ctx: { ip?: string; userAgent?: string }) {
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, include: { statusRef: true } });
  if (!job) throw NotFoundError("Import job");
  if (job.statusRef.value === "completed" || job.statusRef.value === "completed_with_warnings") {
    throw new AppError("CONFLICT", 409, "This import has already been confirmed.");
  }
  const preview = job.preview as unknown as { exceptions: ImportException[]; rows: TrackerRowSerialized[]; mapping: ApplicationMapping[] } | null;
  if (!preview || !Array.isArray(preview.rows) || preview.rows.length === 0) {
    throw new AppError("VALIDATION_ERROR", 422, "No validated preview available — upload the workbook first.");
  }

  const processing = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "processing" } } });
  if (!processing) throw NotFoundError("job_status/processing");
  await prisma.importJob.update({ where: { id: job.id }, data: { status: processing.id } });

  await recordAudit({
    action: "excel_import.confirmed",
    entityType: "ImportJob",
    entityId: job.id,
    newValue: JSON.stringify({ rows: preview.rows.length }),
    source: "HUMAN",
    actorUserId: userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  try {
    const result = await prisma.$transaction(async (tx) =>
      executeImport(tx as unknown as Prisma.TransactionClient, job, preview, userId, ctx),
    );
    const statusValue = result.warningCount > 0 ? "completed_with_warnings" : "completed";
    const statusId = (await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: statusValue } } }))?.id;
    if (!statusId) throw NotFoundError(`job_status/${statusValue}`);
    const done = await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: statusId,
        completedAt: new Date(),
        rowsProcessed: result.rowsProcessed,
        rowsFailed: result.rowsFailed,
        warningCount: result.warningCount,
        summary: {
          applicationsTouched: result.applicationsTouched,
          engagementsCreated: result.engagementsCreated,
          iterationsTouched: result.iterationsTouched,
          exceptions: result.exceptions,
        } as never,
      },
    });
    await recordAudit({
      action: "excel_import.completed",
      entityType: "ImportJob",
      entityId: job.id,
      newValue: JSON.stringify({
        applications: result.applicationsTouched,
        engagements: result.engagementsCreated,
        iterations: result.iterationsTouched,
        rows: result.rowsProcessed,
        warnings: result.warningCount,
      }),
      source: "HUMAN",
      actorUserId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    logger.info("excel_import.completed", { jobId: job.id, rows: result.rowsProcessed, warnings: result.warningCount, actorUserId: userId });
    return { jobId: done.id, ...result };
  } catch (error) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        summary: { fatal: String(error).slice(0, 800) } as never,
        errorCount: 1,
      },
    });
    const failed = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "failed" } } });
    if (failed) {
      await prisma.importJob.update({ where: { id: job.id }, data: { status: failed.id, completedAt: new Date() } });
    }
    await recordAudit({
      action: "excel_import.failed",
      entityType: "ImportJob",
      entityId: job.id,
      newValue: JSON.stringify({ error: String(error).slice(0, 400) }),
      source: "SYSTEM",
      actorUserId: userId,
    });
    logger.error("excel_import.failed", { jobId: job.id, error: String(error) });
    throw error;
  }
}

async function executeImport(
  tx: Prisma.TransactionClient,
  job: { id: number; filename: string; sha256: string; options: Prisma.JsonValue | null },
  preview: { rows: TrackerRowSerialized[]; mapping: ApplicationMapping[]; exceptions: ImportException[] },
  userId: number,
  ctx: { ip?: string; userAgent?: string },
) {
  const options = (job.options ?? {}) as { createMissingApplications?: boolean };
  const warnings = preview.exceptions.filter((e) => e.severity === "warning").length;
  let applicationsTouched = 0;
  let engagementsCreated = 0;
  let iterationsTouched = 0;
  let rowsProcessed = 0;
  let rowsFailed = 0;

  const masterCache = new Map<string, number | null>();
  const master = async (domain: string, value: string): Promise<number | null> => {
    const key = `${domain}/${value}`;
    if (!masterCache.has(key)) {
      const row = await tx.masterValue.findUnique({ where: { domain_value: { domain, value } } });
      masterCache.set(key, row?.id ?? null);
    }
    return masterCache.get(key) ?? null;
  };

  for (let i = 0; i < preview.rows.length; i++) {
    const row = preview.rows[i]!;
    const mapping = preview.mapping[i]!;
    try {
      // ---- Application resolution (§53) ----
      let applicationId = mapping.applicationId;
      if (!applicationId) {
        if (mapping.matched !== "willCreate" || !options.createMissingApplications) {
          rowsFailed += 1; // unresolved rows are skipped with the recorded warning (§53)
          continue;
        }
        const typeId = (await master("application_type", row.typeValue)) ?? (await master("application_type", "other"))!;
        const scopeId = (await master("scope", row.scopeValue ?? "internal")) ?? (await master("scope", "internal"))!;
        const envId = (await master("environment", inferEnvironment(row.applicationRaw))) ?? (await master("environment", "unknown"))!;
        const activeId = (await master("application_status", "active"))!;
        const created = await tx.application.create({
          data: {
            name: row.applicationRaw,
            displayName: row.applicationRaw,
            applicationType: typeId,
            scope: scopeId,
            environment: envId,
            site: activeId,
            webUrl: row.webUrl,
            apiFqdn: row.apiFqdn,
            rawTarget: row.targetRaw,
            assessedOn: row.scanReportDate ? new Date(row.scanReportDate) : null,
          },
        });
        applicationId = created.id;
        // Seed the name as an application alias so future imports match by alias too.
        const nameAliasType = await tx.masterValue.findUnique({ where: { domain_value: { domain: "alias_type", value: "name" } } });
        if (nameAliasType) {
          await tx.applicationAlias.create({
            data: {
              applicationId: created.id,
              alias: row.applicationRaw,
              aliasType: nameAliasType.id,
              normalized: row.applicationNormalized,
              isPrimary: true,
              notes: `Imported ${job.filename}`,
            },
          });
        }
        applicationsTouched += 1;
      }

      // ---- Contacts (POC + assigned members) ----
      const pocId = row.pocRaw ? await upsertContactTx(tx, splitNames(row.pocRaw)[0] ?? null) : null;
      if (pocId) {
        await tx.application.update({ where: { id: applicationId }, data: { primaryPocId: pocId } });
      }
      for (const name of splitNames(row.assignedRaw ?? "")) {
        const contactId = await upsertContactTx(tx, name);
        if (contactId) {
          await tx.applicationAssignedMember.upsert({
            where: { applicationId_contactId: { applicationId, contactId } },
            update: { isActive: true },
            create: { applicationId, contactId },
          });
        }
      }

      // ---- Engagement (§30) ----
      const engagementName = row.mailSubject?.trim() || `VAPT — ${row.applicationRaw}`;
      const scopeId = (await master("scope", row.scopeValue ?? "internal")) ?? (await master("scope", "internal"))!;
      let engagement = await tx.engagement.findUnique({
        where: { applicationId_name: { applicationId, name: engagementName } },
      });
      if (!engagement) {
        const sourceId = (await master("assessment_source", row.assessmentSourceValue)) ?? (await master("assessment_source", "other"))!;
        const engStatusId = (await master("engagement_status", row.overallStatusValue)) ?? (await master("engagement_status", "in_progress"))!;
        engagement = await tx.engagement.create({
          data: {
            applicationId,
            name: engagementName,
            scope: scopeId,
            assessmentSource: sourceId,
            target: row.webUrl ?? row.apiFqdn ?? row.targetRaw,
            mailSubject: row.mailSubject,
            status: engStatusId,
            requestedDate: row.requestedDate ? new Date(row.requestedDate) : null,
            reportDate: row.scanReportDate ? new Date(row.scanReportDate) : null,
            sortOrder: row.sNo,
            notes: row.comments,
          },
        });
        engagementsCreated += 1;
      } else {
        const engStatusId = (await master("engagement_status", row.overallStatusValue)) ?? (await master("engagement_status", "in_progress"))!;
        await tx.engagement.update({
          where: { id: engagement.id },
          data: {
            status: engStatusId,
            target: row.webUrl ?? row.apiFqdn ?? row.targetRaw,
            reportDate: row.scanReportDate ? new Date(row.scanReportDate) : null,
            sortOrder: row.sNo,
            notes: row.comments,
          },
        });
      }

      // ---- Iterations (§12-§15) + snapshot (§36: audit context only) ----
      const iter1TypeId = (await master("iteration_type", "initial_scan"))!;
      const iter1StatusValue = row.iteration1StatusValue ? mapIterationStatus(row.iteration1StatusValue) : "completed";
      const iter1StatusId = (await master("iteration_status", iter1StatusValue)) ?? (await master("iteration_status", "completed"))!;
      await tx.iteration.upsert({
        where: { engagementId_number: { engagementId: engagement.id, number: 1 } },
        update: {
          startDate: row.iteration1Date ? new Date(row.iteration1Date) : (row.requestedDate ? new Date(row.requestedDate) : null),
          reportDate: row.iteration1Date ? new Date(row.iteration1Date) : null,
          status: iter1StatusId,
          importSnapshot: snapshotFor(row, 1) as never,
        },
        create: {
          engagementId: engagement.id,
          number: 1,
          iterationType: iter1TypeId,
          name: "Iteration 1 — Initial Scan",
          startDate: row.iteration1Date ? new Date(row.iteration1Date) : (row.requestedDate ? new Date(row.requestedDate) : null),
          reportDate: row.iteration1Date ? new Date(row.iteration1Date) : null,
          status: iter1StatusId,
          importSnapshot: snapshotFor(row, 1) as never,
        },
      });
      iterationsTouched += 1;

      // §54: iteration 2 requires a recognizable Iteration-2 Status; date alone ("Pending" in date col)
      // is recorded as a date warning by the parser and does NOT invent iteration 2.
      if (row.iteration2StatusValue) {
        const iter2TypeId = (await master("iteration_type", "retest"))!;
        const iter2StatusId = (await master("iteration_status", mapIterationStatus(row.iteration2StatusValue))) ?? (await master("iteration_status", "in_progress"))!;
        await tx.iteration.upsert({
          where: { engagementId_number: { engagementId: engagement.id, number: 2 } },
          update: {
            reportDate: row.iteration2Date ? new Date(row.iteration2Date) : null,
            status: iter2StatusId,
            importSnapshot: snapshotFor(row, 2) as never,
          },
          create: {
            engagementId: engagement.id,
            number: 2,
            iterationType: iter2TypeId,
            name: "Iteration 2 — Retest",
            reportDate: row.iteration2Date ? new Date(row.iteration2Date) : null,
            status: iter2StatusId,
            importSnapshot: snapshotFor(row, 2) as never,
          },
        });
        iterationsTouched += 1;
      }

      rowsProcessed += 1;
    } catch (rowError) {
      rowsFailed += 1;
      logger.warn("excel_import.row_failed", { jobId: job.id, row: row.rowNumber, error: String(rowError).slice(0, 200) });
    }
  }

  void userId;
  void ctx;
  return {
    rowsProcessed,
    rowsFailed,
    warningCount: warnings,
    applicationsTouched,
    engagementsCreated,
    iterationsTouched,
    exceptions: preview.exceptions,
  };
}

function snapshotFor(row: Pick<TrackerRow, "rowNumber" | "counts" | "matrix" | "totalVulnCount">, iterationNo: number): Record<string, unknown> {
  return {
    source: "excel_v1",
    importRow: row.rowNumber,
    iterationNo,
    counts: row.counts,
    matrix: row.matrix,
    totalVulnCount: row.totalVulnCount,
    note: "Imported snapshot (audit context only — live counts derive from findings, §36).",
  };
}

function mapIterationStatus(raw: string): string {
  const key = raw.toLowerCase();
  if (key.includes("complete")) return "completed";
  if (key.includes("progress")) return "in_progress";
  if (key.includes("hold") || key.includes("pending")) return "pending";
  if (key.includes("cancel")) return "cancelled";
  return "in_progress";
}

function inferEnvironment(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("prod") && !lower.includes("pre")) return "prod";
  if (lower.includes("uat")) return "uat";
  if (lower.includes("staging")) return "staging";
  return "unknown";
}

function splitNames(raw: string): string[] {
  return raw
    .split(/[/,]/)
    .map((p) => p.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 3 && p.length <= 60)
    .filter((p) => !/\bet al\.?$/i.test(p));
}

async function upsertContactTx(tx: Prisma.TransactionClient, fullName: string | null): Promise<number | null> {
  if (!fullName) return null;
  try {
    const contact = await tx.contact.upsert({
      where: { org_fullName: { org: "Akasa Air", fullName } },
      update: {},
      create: { fullName, org: "Akasa Air" },
    });
    return contact.id;
  } catch {
    return null;
  }
}
