/**
 * PT Tracker v1.0 Excel export (Phase 3 Â§31/Â§33/Â§35/Â§66).
 *
 * The ORIGINAL workbook (prisma/templates/pt-tracker-v1.xlsx â€” the uploaded
 * file) is the binary template: ExcelJS opens it, ONLY data regions are
 * rewritten, all styling/validation chrome stays untouched. Exported numbers
 * are LIVE database values (Â§36/Â§37) â€” never stale workbook snapshots.
 * Totals are rewritten as explicit SUM formulas over the exported range
 * (no stale #REF! formulas are recreated, Â§35).
 */
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import ExcelJS from "exceljs";
import {
  CANONICAL_SCOPE_TO_RAW,
  CANONICAL_STATUS_TO_RAW,
  CANONICAL_TYPE_TO_RAW,
  TRACKER_SHEET,
  DATA_START_ROW,
  LAST_TEMPLATE_DATA_ROW,
  SCHEMA_NAME,
  SCHEMA_VERSION,
} from "./contract";


export function templatePath(): string {
  const fromEnv = process.env.EXCEL_TEMPLATE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const bundled = path.resolve(process.cwd(), "prisma", "templates", "pt-tracker-v1.xlsx");
  if (fs.existsSync(bundled)) return bundled;
  throw new AppError("INTERNAL_ERROR", 500, "The PT Tracker template workbook is missing from the deployment.");
}

const MATRIX_TOTAL_SOURCE_ROW = 32; // template puts matrix totals on row 32 (AE..AN)
const TOTALS_ROW = 33; // template totals row (U..AC formulas)

export interface TrackerExportRow {
  applicationId: number;
  sNo: number;
  name: string;
  scopeRaw: string;
  target: string | null;
  mailSubject: string | null;
  engagementName: string;
  typeRaw: string;
  assessmentTypeRaw: string;
  overallStatusRaw: string;
  poc: string | null;
  assigned: string | null;
  requestedDate: Date | null;
  reportDate: Date | null;
  iteration1: { startDate: Date | null; reportDate: Date | null; statusRaw: string } | null;
  iteration2: { reportDate: Date | null; statusRaw: string } | null;
  description: string | null; // Comments (R) — engagement notes / AI thread summary
  followUpResponse: string | null; // Follow-up Response (T) — manually set responses
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    car: number;
    total: number;
    pending: number;
    closed: number;
    openBySeverity: { critical: number; high: number; medium: number; low: number; info: number };
    closedBySeverity: { critical: number; high: number; medium: number; low: number; info: number };
  };
}

/** One efficient pass: gather everything, compute live counts in memory (Â§57). */
export async function buildExportRows(): Promise<TrackerExportRow[]> {
  const apps = await prisma.application.findMany({
    where: { isActive: true },
    include: {
      scopeRef: true,
      applicationTypeRef: true,
      primaryPoc: { select: { fullName: true } },
      assignedMembers: { include: { contact: { select: { fullName: true } } } },
      engagements: {
        include: {
          sourceRef: true,
          statusRef: true,
          iterations: { orderBy: { number: "asc" }, include: { iterationTypeRef: true, statusRef: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  const findings = await prisma.finding.findMany({
    where: { application: { isActive: true } },
    select: { applicationId: true, severityRef: { select: { value: true } }, statusRef: { select: { value: true } } },
  });

  type Bucket = { critical: number; high: number; medium: number; low: number; info: number };
  const perApp = new Map<number, { open: Bucket; closed: Bucket; car: number; notFixedOpen: number }>();
  const emptyBucket = (): Bucket => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  const bump = (b: Bucket, sev: string) => {
    if (sev === "critical") b.critical += 1;
    else if (sev === "high") b.high += 1;
    else if (sev === "medium") b.medium += 1;
    else if (sev === "low") b.low += 1;
    else b.info += 1;
  };
  for (const f of findings) {
    const entry = perApp.get(f.applicationId) ?? { open: emptyBucket(), closed: emptyBucket(), car: 0, notFixedOpen: 0 };
    if (f.statusRef.value === "fixed") bump(entry.closed, f.severityRef.value);
    else if (f.statusRef.value === "accepted_risk") entry.car += 1;
    else if (["open", "new", "not_fixed", "not_retested"].includes(f.statusRef.value)) {
      bump(entry.open, f.severityRef.value);
      entry.notFixedOpen += 1;
    }
    perApp.set(f.applicationId, entry);
  }

  const rows: TrackerExportRow[] = [];
  let sNo = 1;
  for (const app of apps) {
    const engagement = app.engagements[0];
    const iters = engagement?.iterations ?? [];
    const iter1 = iters.find((it) => it.number === 1);
    const iter2 = iters.find((it) => it.number === 2);
    const agg = perApp.get(app.id) ?? { open: emptyBucket(), closed: emptyBucket(), car: 0, notFixedOpen: 0 };
    const total = agg.open.critical + agg.open.high + agg.open.medium + agg.open.low + agg.open.info + agg.closed.critical + agg.closed.high + agg.closed.medium + agg.closed.low + agg.closed.info + agg.car;
    rows.push({
      applicationId: app.id,
      sNo: sNo++,
      name: app.name,
      scopeRaw: CANONICAL_SCOPE_TO_RAW[app.scopeRef.value] ?? app.scopeRef.label,
      target: app.webUrl ?? app.apiFqdn ?? app.rawTarget,
      mailSubject: engagement?.mailSubject ?? null,
      engagementName: engagement?.name ?? `VAPT â€” ${app.displayName}`,
      typeRaw: CANONICAL_TYPE_TO_RAW[app.applicationTypeRef.value] ?? "Other",
      assessmentTypeRaw: engagement?.sourceRef?.label ?? "VAPT",
      overallStatusRaw: CANONICAL_STATUS_TO_RAW[engagement?.statusRef.value ?? "initiated"] ?? "Initiated / Walkthrough Pending",
      poc: app.primaryPoc?.fullName ?? null,
      assigned: app.assignedMembers.length ? app.assignedMembers.map((m) => m.contact.fullName).join(" / ") : null,
      requestedDate: engagement?.requestedDate ?? null,
      reportDate: engagement?.reportDate ?? null,
      iteration1: iter1
        ? {
            startDate: iter1.startDate,
            reportDate: iter1.reportDate,
            statusRaw: CANONICAL_STATUS_TO_RAW[iter1.statusRef.value] ?? "In Progress",
          }
        : null,
      iteration2: iter2
        ? {
            reportDate: iter2.reportDate,
            statusRaw: CANONICAL_STATUS_TO_RAW[iter2.statusRef.value] ?? "Pending",
          }
        : null,
      description: engagement?.notes ?? null,
      followUpResponse: null, // future extension — no UI writes this yet
      counts: {
        critical: agg.open.critical + agg.closed.critical,
        high: agg.open.high + agg.closed.high,
        medium: agg.open.medium + agg.closed.medium,
        low: agg.open.low + agg.closed.low,
        info: agg.open.info + agg.closed.info,
        car: agg.car,
        total,
        pending: agg.notFixedOpen,
        closed:
          agg.closed.critical + agg.closed.high + agg.closed.medium + agg.closed.low + agg.closed.info,
        openBySeverity: agg.open,
        closedBySeverity: agg.closed,
      },
    });
  }
  return rows;
}

/** Render the workbook and record the ExportJob (Â§40). */
export async function exportTrackerWorkbook(
  userId: number,
  ctx: { ip?: string; userAgent?: string },
): Promise<{ buffer: Buffer; filename: string; jobId: number; rows: number }> {
  const started = new Date();
  await recordAudit({
    action: "excel_export.started",
    entityType: "ExportJob",
    newValue: JSON.stringify({ target: "xlsx", schemaVersion: SCHEMA_VERSION }),
    source: "HUMAN",
    actorUserId: userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  const processing = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "processing" } } });
  if (!processing) throw NotFoundError("job_status/processing");
  const sv = await prisma.schemaVersion.findUnique({ where: { trackerName_version: { trackerName: SCHEMA_NAME, version: SCHEMA_VERSION } } });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath());
  const sheet = workbook.worksheets.find((ws) => ws.name === TRACKER_SHEET);
  if (!sheet) throw new AppError("INVALID_EXCEL_SCHEMA", 422, `Template sheet "${TRACKER_SHEET}" is missing.`);
  applyAkasaLightTheme(sheet);

  const exportRows = await buildExportRows();
  if (exportRows.length > LAST_TEMPLATE_DATA_ROW - DATA_START_ROW + 1) {
    throw new AppError("VALIDATION_ERROR", 422, `The PT Tracker v1.0 template supports up to ${LAST_TEMPLATE_DATA_ROW - DATA_START_ROW + 1} application rows; requested ${exportRows.length}. Contact the platform team to extend the contract (schema change).`);
  }

  // ---- Single pass: write each data row completely (A..AN) ----
  for (let i = 0; i < exportRows.length; i++) {
    const e = exportRows[i]!;
    const rowNumber = DATA_START_ROW + i;
    const row = sheet.getRow(rowNumber);
    // Values only; ExcelJS preserves existing cell styles when not touched.
    row.getCell(1).value = e.sNo; // A S.no
    row.getCell(2).value = e.name; // B Application (plain string â€” survives re-import)
    row.getCell(3).value = e.scopeRaw; // C
    row.getCell(4).value = e.target; // D (hyperlink objects replaced with plain values)
    row.getCell(5).value = e.mailSubject ?? e.engagementName; // E (engagement thread key)
    row.getCell(6).value = e.typeRaw; // F
    row.getCell(7).value = e.assessmentTypeRaw; // G
    if (e.poc) row.getCell(8).value = e.poc; // H
    if (e.assigned) row.getCell(9).value = e.assigned; // I
    row.getCell(10).value = e.overallStatusRaw; // J
    row.getCell(11).value = e.counts.total; // K Total Vuln Count (live)
    if (engagementReportDate(e)) row.getCell(12).value = engagementReportDate(e); // L
    if (e.requestedDate) row.getCell(13).value = e.requestedDate; // M
    if (e.iteration1?.startDate) row.getCell(14).value = e.iteration1.startDate; // N
    if (e.iteration1) row.getCell(15).value = e.iteration1.statusRaw; // O
    if (e.iteration2?.reportDate) row.getCell(16).value = e.iteration2.reportDate; // P
    if (e.iteration2) row.getCell(17).value = e.iteration2.statusRaw; // Q
    row.getCell(21).value = e.counts.critical; // U
    row.getCell(22).value = e.counts.high; // V
    row.getCell(23).value = e.counts.medium; // W
    row.getCell(24).value = e.counts.low; // X
    row.getCell(25).value = e.counts.info; // Y
    row.getCell(26).value = e.counts.car; // Z
    row.getCell(27).value = e.counts.total; // AA
    row.getCell(28).value = e.counts.pending; // AB
    row.getCell(29).value = e.counts.closed; // AC
    row.getCell(31).value = e.counts.openBySeverity.critical; // AE
    row.getCell(32).value = e.counts.closedBySeverity.critical; // AF
    row.getCell(33).value = e.counts.openBySeverity.high; // AG
    row.getCell(34).value = e.counts.closedBySeverity.high; // AH
    row.getCell(35).value = e.counts.openBySeverity.medium; // AI
    row.getCell(36).value = e.counts.closedBySeverity.medium; // AJ
    row.getCell(37).value = e.counts.openBySeverity.low; // AK
    row.getCell(38).value = e.counts.closedBySeverity.low; // AL
    row.getCell(39).value = e.counts.openBySeverity.info; // AM
    row.getCell(40).value = e.counts.closedBySeverity.info; // AN
    // Comments (R = col 18) and Follow-up Response (T = col 20) from the engagement
    // (Phase 9.1: description/notes from analyzed threads + manual follow-ups)
    if (e.description) row.getCell(18).value = e.description;
    if (e.followUpResponse) row.getCell(20).value = e.followUpResponse;
    row.commit();
  }

  // ---- Clear leftover template data rows (formats preserved, values blanked) ----
  for (let r = DATA_START_ROW + exportRows.length; r <= LAST_TEMPLATE_DATA_ROW; r++) {
    const row = sheet.getRow(r);
    let touched = false;
    for (let c = 1; c <= 40; c++) {
      if (c === 30) continue; // spacer column stays untouched
      const existing = row.getCell(c).value;
      if (existing !== null && existing !== undefined) {
        row.getCell(c).value = null;
        touched = true;
      }
    }
    if (touched) row.commit();
  }

  // ---- Totals (Â§35): explicit SUMs across the exported range; no stale refs ----
  const lastData = DATA_START_ROW + exportRows.length - 1;
  const totalsRow = sheet.getRow(TOTALS_ROW);
  for (const [col, letter] of [
    [21, "U"],
    [22, "V"],
    [23, "W"],
    [24, "X"],
    [25, "Y"],
    [26, "Z"],
    [27, "AA"],
    [28, "AB"],
    [29, "AC"],
  ] as [number, string][]) {
    totalsRow.getCell(col).value = { formula: `SUM(${letter}3:${letter}${lastData})` };
  }
  totalsRow.commit();

  if (exportRows.length > 0) {
    // Template quirk (DL-02): matrix totals sit on the last data row (AE..AN).
    const matrixTotalsRow = sheet.getRow(MATRIX_TOTAL_SOURCE_ROW === 32 ? lastData : MATRIX_TOTAL_SOURCE_ROW);
    for (const [col, letter] of [
      [31, "AE"],
      [32, "AF"],
      [33, "AG"],
      [34, "AH"],
      [35, "AI"],
      [36, "AJ"],
      [37, "AK"],
      [38, "AL"],
      [39, "AM"],
      [40, "AN"],
    ] as [number, string][]) {
      matrixTotalsRow.getCell(col).value = { formula: `SUM(${letter}3:${letter}${lastData})` };
    }
    matrixTotalsRow.commit();
  }

  const written = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(written as ArrayBuffer);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `PT Tracker ${stamp} â€” exported.xlsx`;

  const completed = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "completed" } } });
  if (!completed) throw NotFoundError("job_status/completed");
  const job = await prisma.exportJob.create({
    data: {
      filename,
      target: "xlsx",
      targetVersion: SCHEMA_VERSION,
      schemaVersionId: sv?.id ?? null,
      status: completed.id,
      params: { applications: exportRows.length, generatedAt: started.toISOString() },
      startedAt: started,
      completedAt: new Date(),
      rowsProcessed: exportRows.length,
      createdByUserId: userId,
    },
  });
  await recordAudit({
    action: "excel_export.completed",
    entityType: "ExportJob",
    entityId: job.id,
    newValue: JSON.stringify({ filename, rows: exportRows.length, schemaVersion: SCHEMA_VERSION }),
    source: "HUMAN",
    actorUserId: userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  logger.info("excel_export.completed", { jobId: job.id, rows: exportRows.length, actorUserId: userId });

  return { buffer, filename, jobId: job.id, rows: exportRows.length };
}

function engagementReportDate(e: TrackerExportRow): Date | null {
  return e.reportDate ?? e.iteration1?.reportDate ?? null;
}

/**
 * Light Akasa Air skin, applied to the EXPORTED workbook only — column layout,
 * header text, values, merged cells and column widths are NEVER moved or
 * renamed (39-column contract stays binary-stable). Touches fills + font
 * colors only: group-label row 1 (soft sunrise orange), header row 2 (light
 * peach + deep plum), totals row (warm plum tint). Import reads values, so
 * the round trip is unaffected.
 */
function applyAkasaLightTheme(sheet: ExcelJS.Worksheet): void {
  const plum = "FF3D2054";
  const deepOrange = "FFE0550C";

  // Row 1 — severity group labels (merged "Critical/Open/Closed" pairs, AE..AN).
  const groupRow = sheet.getRow(1);
  groupRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2E8" } };
    cell.font = { ...cell.font, bold: true, color: { argb: deepOrange }, size: cell.font?.size ?? 10 };
  });
  groupRow.commit();

  // Row 2 — the contracted header row (A..AN).
  const headerRow = sheet.getRow(2);
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE3CF" } };
    cell.font = { ...cell.font, bold: true, color: { argb: plum }, size: cell.font?.size ?? 11 };
    cell.alignment = { ...cell.alignment, vertical: "middle", horizontal: "center", wrapText: true };
  });
  headerRow.commit();

  // Totals row — SUM row (U..AN) gets a warm plum band; values/format untouched.
  const totalsRow = sheet.getRow(TOTALS_ROW);
  totalsRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6EFE7" } };
    cell.font = { ...cell.font, bold: true, color: { argb: plum }, size: cell.font?.size ?? 11 };
  });
  totalsRow.commit();
}



