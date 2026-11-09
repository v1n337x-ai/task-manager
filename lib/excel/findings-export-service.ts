/**
 * Findings workbook export — the analyst's requested workbook layout:
 * - a Master Summary sheet with one row per application
 * - one sheet per application
 * - on each application sheet, Iteration 1 and Iteration 2 sit side by side,
 *   using the same columns, colors, fonts and cell borders as vapt.xlsx
 * The layout deliberately mirrors the analyst template (Calibri, thin black
 * gridlines, severity fill chips) while remaining live from DB findings.
 */
import { prisma } from "@/lib/db";
import ExcelJS from "exceljs";
import { generateDashboardReport } from "../services/reporting/report-service";
import { duplicateMasterPlaceholderIds } from "@/lib/services/finding-placeholder-utils";
import { lightTint } from "@/lib/services/branding-service";

const HEADER_FILL = "FFBCD4D8";
const ROW_FILL = "FFECF2F3";
const THIN_BORDER = { style: "thin" as const, color: { indexed: 64 } };
const BORDER = { left: THIN_BORDER, right: THIN_BORDER, top: THIN_BORDER, bottom: THIN_BORDER };

const SEV_FILL: Record<string, string> = {
  critical: "FFC1272D",
  high: "FFF7931E",
  medium: "FFFCEE21",
  low: "FF39B54A",
  info: "FF0070C0",
};
const SEV_TEXT: Record<string, string> = {
  critical: "FFFFFFFF",
  high: "FFFFFFFF",
  medium: "FF171717",
  low: "FFFFFFFF",
  info: "FFFFFFFF",
};

function styleCell(cell: ExcelJS.Cell, options: { bold?: boolean; fill?: string; color?: string; align?: string; size?: number }) {
  const current = cell.style ?? {};
  cell.style = {
    ...(current as object),
    font: { name: "Calibri", size: options.size ?? 11, bold: options.bold ?? false, color: { argb: options.color ?? "FF171717" } },
    fill: options.fill ? { type: "pattern", pattern: "solid", fgColor: { argb: options.fill } } : current.fill,
    border: BORDER,
    alignment: { horizontal: (options.align ?? "left") as never, vertical: "middle", wrapText: true },
  } as never;
}

function headerStyle(cell: ExcelJS.Cell) {
  styleCell(cell, { bold: true, fill: HEADER_FILL, color: "FF171717", align: "center", size: 12 });
}

function dataStyle(cell: ExcelJS.Cell, fill = ROW_FILL) {
  styleCell(cell, { fill, size: 11 });
}

function severityStyle(cell: ExcelJS.Cell, severity: string, value: string) {
  cell.value = value;
  styleCell(cell, { bold: true, fill: SEV_FILL[severity] ?? ROW_FILL, color: SEV_TEXT[severity] ?? "FF171717", align: "center", size: 12 });
}

function safeSheetName(displayName: string, fallback: number): string {
  const base = displayName.replace(/[:\\\/?*[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 28) || `App ${fallback}`;
  return base;
}

function statusLabel(value: string): string {
  const map: Record<string, string> = {
    open: "",
    new: "",
    not_fixed: "Not Fixed",
    not_retested: "",
    fixed: "Fixed",
    reopened: "Not Fixed",
    accepted_risk: "Accepted Risk",
  };
  return map[value] ?? value;
}

export async function exportFindingsWorkbook(): Promise<{ buffer: Buffer; filename: string; rows: number }> {
  const report = await generateDashboardReport();
  const apps = await prisma.application.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      findings: {
        where: { isActive: true },
        include: {
          severityRef: { select: { value: true } },
          iterationStates: { include: { iteration: { select: { number: true } }, statusRef: { select: { value: true } }, severityRef: { select: { value: true } } } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Task Manager";
  workbook.created = new Date();

  // ---------------- Master Summary ----------------
  const master = workbook.addWorksheet("Master Summary");
  (master as unknown as { views?: unknown }).views = [{ state: "frozen", ySplit: 1 }];
  const masterHeaders = ["#", "Application", "Status", "Type", "Scope", "Total", "Critical", "High", "Medium", "Low", "Info", "Pending", "Fixed", "Not Fixed", "CAR"];
  master.columns = masterHeaders.map((h) => ({ header: h, width: h === "Application" ? 34 : 14 }));
  master.getRow(1).height = 30;
  for (let c = 1; c <= masterHeaders.length; c++) headerStyle(master.getRow(1).getCell(c));

  report.applications.forEach((a, i) => {
    const row = master.addRow([
      i + 1,
      a.displayName,
      a.statusLabel,
      a.typeName,
      a.scopeLabel,
      a.counts.total,
      a.counts.critical,
      a.counts.high,
      a.counts.medium,
      a.counts.low,
      a.counts.info,
      a.counts.pending,
      a.counts.fixed,
      a.counts.notFixed,
      a.counts.car,
    ]);
    row.height = 24;
    row.eachCell((cell, col) => {
      dataStyle(cell);
      cell.numFmt = col === 1 || col >= 6 ? "0" : "General";
      if (col === 2) cell.alignment = { vertical: "middle", wrapText: true };
    });
  });
  const totalsRow = master.addRow([
    "",
    `Total (${report.totalApplications})`,
    "",
    "",
    "",
    report.totalFindings,
    report.severityBreakdown.critical,
    report.severityBreakdown.high,
    report.severityBreakdown.medium,
    report.severityBreakdown.low,
    report.severityBreakdown.info,
    report.pendingFindings,
    report.closedFindings,
    report.statusBreakdown.notFixed,
    report.carVerified,
  ]);
  totalsRow.eachCell((cell, col) => {
    styleCell(cell, { bold: true, fill: HEADER_FILL, align: col === 2 ? "left" : "center", size: 12 });
    cell.numFmt = col === 1 || col >= 6 ? "0" : "General";
  });
  master.autoFilter = { from: "A1", to: { row: 1, column: masterHeaders.length } };

  // ---------------- Per-application findings sheets ----------------
  const usedSheetNames = new Set(["Master Summary"]);
  for (const app of apps) {
    let sheetName = safeSheetName(app.displayName, app.id);
    if (usedSheetNames.has(sheetName)) {
      const base = app.displayName.replace(/[:\\\/?*[\]]/g, "-").replace(/\s+/g, " ").trim();
      sheetName = `${base.slice(0, 23)} ${app.id}`.slice(0, 31);
    }
    usedSheetNames.add(sheetName);
    const ws = workbook.addWorksheet(sheetName);
    (ws as unknown as { views?: unknown }).views = [{ state: "frozen", ySplit: 2 }];
    ws.columns = [
      { width: 5 },
      { width: 58 },
      { width: 18 },
      { width: 16 },
      { width: 5 },
      { width: 58 },
      { width: 18 },
      { width: 18 },
    ];

    const row1At = 1;
    const headerAt = 2;
    // Iteration 1 spans A:C, Iteration 2 spans E:H
    ws.mergeCells("A1:C1");
    const i1Title = ws.getRow(row1At).getCell(1);
    i1Title.value = `Iteration 1`;
    styleCell(i1Title, { bold: true, fill: HEADER_FILL, align: "center", size: 12 });
    ws.getRow(row1At).getCell(2).style = { ...(i1Title.style ?? {}), fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } } };
    ws.getRow(row1At).getCell(3).style = { ...(i1Title.style ?? {}), fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } } };

    ws.mergeCells("E1:H1");
    const i2Title = ws.getRow(row1At).getCell(5);
    i2Title.value = `Iteration 2`;
    styleCell(i2Title, { bold: true, fill: HEADER_FILL, align: "center", size: 12 });
    for (const c of [6, 7, 8]) ws.getRow(row1At).getCell(c).style = { ...(i2Title.style ?? {}), fill: { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } } };

    const headers = ["#", "Name of the vulnerability", "Severity", "", "#", "Name of the vulnerability", "Severity", "Status"];
    headers.forEach((h, idx) => {
      const cell = ws.getRow(headerAt).getCell(idx + 1);
      cell.value = h || null;
      if (h) headerStyle(cell);
    });
    ws.getRow(headerAt).height = 30;

    const duplicatePlaceholderIds = duplicateMasterPlaceholderIds(app.findings);
    const findings = app.findings.filter((f) => !duplicatePlaceholderIds.has(f.id));
    const iterationState = (f: (typeof findings)[number], number: 1 | 2) =>
      f.iterationStates.find((s) => s.iteration.number === number);
    const i1Rows = findings
      .filter((f) => (f.firstSeenIterationNumber ?? 1) <= 1 || iterationState(f, 1))
      .map((f) => ({
        no: f.code,
        title: f.title,
        sev: iterationState(f, 1)?.severityRef.value ?? f.severityRef.value,
        isNew: (f.firstSeenIterationNumber ?? 1) === 2 && !iterationState(f, 1),
      }));
    const i2Rows = findings
      .filter((f) => iterationState(f, 2))
      .map((f) => {
        const state = iterationState(f, 2)!;
        const status = statusLabel(state.statusRef.value);
        return { no: f.code, title: f.title, sev: state.severityRef.value, status: status || null, isNew: (f.firstSeenIterationNumber ?? 1) === 2 && !iterationState(f, 1) };
      })
      .filter((r) => r.status !== null);

    const maxRows = Math.max(i1Rows.length, i2Rows.length, 1);
    for (let i = 0; i < maxRows; i++) {
      const r = headerAt + 1 + i;
      ws.getRow(r).height = 24;
      const a = i1Rows[i];
      if (a) {
        const noCell = ws.getRow(r).getCell(1);
        noCell.value = a.no;
        dataStyle(noCell);
        noCell.alignment = { horizontal: "right", vertical: "middle" };
        const titleCell = ws.getRow(r).getCell(2);
        titleCell.value = a.title;
        dataStyle(titleCell);
        severityStyle(ws.getRow(r).getCell(3), a.sev, a.sev.charAt(0).toUpperCase() + a.sev.slice(1));
      }
      const b = i2Rows[i];
      if (b) {
        const noCell = ws.getRow(r).getCell(5);
        noCell.value = b.no;
        dataStyle(noCell);
        noCell.alignment = { horizontal: "right", vertical: "middle" };
        const titleCell = ws.getRow(r).getCell(6);
        titleCell.value = b.title;
        if (b.isNew) {
          styleCell(titleCell, { bold: true, fill: "FFD5E8D4", color: "FF375623", size: 11 });
        } else {
          dataStyle(titleCell);
        }
        severityStyle(ws.getRow(r).getCell(7), b.sev, b.sev.charAt(0).toUpperCase() + b.sev.slice(1));
        const statusCell = ws.getRow(r).getCell(8);
        statusCell.value = b.status;
        dataStyle(statusCell, b.status === "Fixed" ? "FFD5E8D4" : b.status === "Not Fixed" ? "FFFCE4D6" : ROW_FILL);
        statusCell.alignment = { horizontal: "center", vertical: "middle" };
        statusCell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF171717" } };
      }
    }
    ws.autoFilter = { from: "A2", to: { row: headerAt, column: 8 } };
  }

  void lightTint;
  const written = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(written as ArrayBuffer), filename: `VAPT Findings Workbook ${new Date().toISOString().slice(0, 10)}.xlsx`, rows: apps.length };
}
