/**
 * Live PPT export (Phase 7 §24-§37): pptxgenjs, VAPT visual family
 * (Bebas Neue/Poppins, ink #1F1F1F, red #CF1325, severity colors, KPI cards
 * with accent bars), 16:9, from ONE report snapshot (§29). Content validation
 * + export job + audit (§34/§35/§32).
 */
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { getStoredTemplate } from "@/lib/services/ppt-template-service";
import { buildTemplateValueUpdate } from "@/lib/services/ppt-template-engine";
import { sanitizeReportSegment, generateDashboardReport, type FiltersAlias as ReportFiltersAlias, type DashboardReport } from "./report-service";

const A = {
  INK: "1F1F1F",
  WHITE: "FFFFFF",
  RED: "CF1325",
  MUTED: "7A7A7A",
  STROKE: "E0E0E0",
  HIGH: "E86B10",
  MEDIUM: "F5A623",
  LOW: "4A90D9",
  PAGE: "FFFFFF",
  GOOD: "2E862E",
  ORANGE: "F37021",
  VIOLET: "9B7BB5",
};

interface PptFactory {
  PptxGenJs: { new (): PptxLike };
}

interface PptxLike {
  defineLayout: (o: { name: string; width: number; height: number }) => void;
  layout: string;
  addSlide: () => SlideLike;
  writeFile?: (o: { outputType?: string }) => Promise<unknown>;
  write: (o: { outputType: "nodebuffer" }) => Promise<Buffer>;
}

interface SlideLike {
  background: { color: string };
  addText: (text: string | TextLike[], opts: Record<string, unknown>) => void;
  addImage: (opts: Record<string, unknown>) => void;
  addTable: (rows: Array<TableLike[]>, opts: Record<string, unknown>) => void;
  addChart: (type: string, data: { name: string; labels: string[]; values: number[] }[], opts: Record<string, unknown>) => void;
  addShape: (type: string, opts: Record<string, unknown>) => void;
}

interface TextLike {
  text: string;
  options?: Record<string, unknown>;
}

type TableLike = { text: string; options?: Record<string, unknown> };

async function loadPptx(): Promise<PptFactory> {
  const mod = (await import("pptxgenjs")) as unknown as { default: { new (): PptxLike } };
  return { PptxGenJs: mod.default };
}

export async function countSlidesInBuffer(buffer: Buffer): Promise<number> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
}

/** §34/§35 — programmatic validation of the generated deck. */
async function validateGeneratedDeck(buffer: Buffer, expectedKpis: { total: number; pending: number; closed: number; car: number; slideCount: number }): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  const { execSync } = await import("node:child_process");
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pptcheck-"));
  const file = path.join(tmp, "check.pptx");
  fs.writeFileSync(file, buffer);
  try {
    execSync(`tar -xf "${file}" -C "${tmp}"`, { stdio: "pipe" });
  } catch {
    execSync(`powershell -Command "Expand-Archive -Path '${file}' -DestinationPath '${tmp + "-x"}' -Force"`, { stdio: "pipe" });
  }
  const slideDir = fs.existsSync(path.join(tmp, "ppt", "slides")) ? path.join(tmp, "ppt", "slides") : path.join(tmp + "-x", "ppt", "slides");
  const slideFiles = fs.readdirSync(slideDir).filter((f) => f.endsWith(".xml"));
  if (slideFiles.length !== expectedKpis.slideCount) problems.push(`slide count ${slideFiles.length} != ${expectedKpis.slideCount}`);

  for (const f of slideFiles) {
    const xml = fs.readFileSync(path.join(slideDir, f), "utf8");
    if (/undefined|NaN/.test(xml)) problems.push(`${f}: contains undefined/NaN`);
  }

  const allSlides = slideFiles.map((f) => fs.readFileSync(path.join(slideDir, f), "utf8")).join("\n");
  const summarySlide = slideFiles.map((f) => path.join(slideDir, f)).find((p) => {
    const xml = fs.readFileSync(p, "utf8");
    return xml.includes("Executive Summary") && (xml.includes("Total findings") || xml.includes("Status Distribution"));
  });
  const slide1 = summarySlide ? fs.readFileSync(summarySlide, "utf8") : allSlides;
  const has = (v: string) => slide1.includes(`>${v}<`) || slide1.includes(`>${v}<`) || slide1.includes(`>${v}`) && slide1.includes(`<${v}>`);
  if (!slide1.includes(String(expectedKpis.total))) problems.push("KPI total missing on summary slide");
  if (!slide1.includes(String(expectedKpis.pending))) problems.push("KPI pending missing");
  if (!slide1.includes(String(expectedKpis.closed))) problems.push("KPI closed missing");
  void has;

  for (const dir of [tmp, tmp + "-x"]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp cleanup best-effort */ }
  }
  return { ok: problems.length === 0, problems };
}

export async function exportPptReport(params: {
  userId: number;
  filters: ReportFiltersAlias;
  ctx: { ip?: string; userAgent?: string };
}): Promise<{ buffer: Buffer; filename: string; jobId: number; validation: { ok: boolean; problems: string[] } }> {
  const report: DashboardReport = await generateDashboardReport(params.filters);
  await recordAudit({
    action: "ppt_export.started",
    entityType: "ExportJob",
    newValue: JSON.stringify({ filters: params.filters, generatedAt: report.generatedAt }),
    source: "HUMAN",
    actorUserId: params.userId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });

  const processing = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "processing" } } });
  if (!processing) throw NotFoundError("job_status/processing");

  // Uploaded client template: preserve its design and update only values.
  // If patching fails, fall back to the existing safe generated deck.
  const storedTemplate = await getStoredTemplate().catch(() => null);
  let templateBuffer: Buffer | null = null;
  if (storedTemplate) {
    try {
      const engagements = await prisma.engagement.findMany({
        where: { application: { isActive: true, ...(params.filters.applicationId ? { id: params.filters.applicationId } : {}) } },
        include: { statusRef: true },
      });
      const statusCounts = new Map<string, number>();
      const engagementStatusByAppId = new Map<number, string>();
      for (const e of engagements) {
        statusCounts.set(e.statusRef.label, (statusCounts.get(e.statusRef.label) ?? 0) + 1);
        engagementStatusByAppId.set(e.applicationId, e.statusRef.label);
      }
      templateBuffer = await buildTemplateValueUpdate(report, storedTemplate.buffer, statusCounts, engagementStatusByAppId);
    } catch {
      templateBuffer = null;
    }
  }

  const { PptxGenJs } = await loadPptx();

  const pptx = new PptxGenJs();
  pptx.defineLayout({ name: "VAPT169", width: 13.33, height: 7.5 });
  pptx.layout = "VAPT169";

  const pptTemplateDir = path.join(process.cwd(), "prisma", "templates", "ppt");
  const brandLogo = path.join(pptTemplateDir, "image3.png");
  const partnerLogo = path.join(pptTemplateDir, "image1.png");
  const coverHero = path.join(pptTemplateDir, "image2.jpeg");

  const slideCount = 6;
  let slideIndex = 0;
  const newSlide = () => {
    slideIndex += 1;
    const slide = pptx.addSlide();
    slide.background = { color: A.PAGE };
    // Task Manager orange band + violet rule motif (security-vendor/Task Manager template)
    slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 1.15, fill: { color: A.ORANGE }, line: { color: A.ORANGE } });
    slide.addShape("rect", { x: 0, y: 1.15, w: 13.33, h: 0.06, fill: { color: A.VIOLET }, line: { color: A.VIOLET } });
    if (fs.existsSync(brandLogo)) slide.addImage({ path: brandLogo, x: 10.62, y: 0.24, w: 2.1, h: 0.51 });
    if (fs.existsSync(partnerLogo)) slide.addImage({ path: partnerLogo, x: 11.39, y: 6.98, w: 1.35, h: 0.33 });
    return slide;
  };

  const addHeader = (slide: { addText: (t: string | TextLike[], o: Record<string, unknown>) => void }, title: string, subtitle: string) => {
    slide.addText([
      { text: title, options: { fontFace: "Bebas Neue", fontSize: 30, color: A.WHITE, bold: true } },
    ], { x: 0.5, y: 0.16, w: 12.4, h: 0.7 });
    slide.addText(subtitle, { x: 0.5, y: 0.82, w: 12.4, h: 0.3, fontFace: "Poppins", fontSize: 10.5, color: "BBBBBB" });
  };

  const kpiCard = (slide: { addText: (t: string | TextLike[], o: Record<string, unknown>) => void; addShape: (t: string, o: Record<string, unknown>) => void }, x: number, y: number, label: string, value: string | number, accent: string) => {
    slide.addShape("roundRect", { x, y, w: 2.9, h: 1.05, fill: { color: A.WHITE }, line: { color: A.STROKE } });
    slide.addShape("rect", { x: x + 0.06, y: y + 0.06, w: 2.78, h: 0.07, fill: { color: accent }, line: { color: accent } });
    slide.addText(String(value), { x: x + 0.15, y: y + 0.2, w: 2.6, h: 0.55, fontFace: "Bebas Neue", fontSize: 30, color: accent, bold: true });
    slide.addText(label, { x: x + 0.15, y: y + 0.74, w: 2.6, h: 0.25, fontFace: "Poppins", fontSize: 10, color: A.MUTED });
  };

  // Slide 1 — Cover (§28.1)
  const cover = newSlide();
  if (fs.existsSync(coverHero)) cover.addImage({ path: coverHero, x: 0.43, y: 1.22, w: 6.93, h: 6.08 });
  addHeader(cover, "TASK MANAGER", "VAPT");
  cover.addText("Vulnerability Assessment & Penetration Testing", { x: 7.55, y: 2.4, w: 5.2, h: 0.9, fontFace: "Bebas Neue", fontSize: 40, color: A.INK });
  cover.addText(`Program Status Report & Findings — generated ${new Date(report.generatedAt).toLocaleDateString("en-GB")}`, { x: 7.55, y: 3.4, w: 5.2, h: 0.4, fontFace: "Poppins", fontSize: 14, color: A.MUTED });

  // Slide 2 — Executive summary KPIs (§28.2/§28.3)
  const summary = newSlide();
  addHeader(summary, "Executive Summary", "Live authoritative numbers — identical to dashboard/reports");
  const gap = 3.12;
  const row1 = 1.7;
  const row2 = 3.0;
  kpiCard(summary, 0.45, row1, "Applications", report.totalApplications, A.RED);
  kpiCard(summary, 0.45 + gap, row1, "Total findings", report.totalFindings, A.HIGH);
  kpiCard(summary, 0.45 + gap * 2, row1, "Pending", report.pendingFindings, A.RED);
  kpiCard(summary, 0.45 + gap * 3, row1, "Closed", report.closedFindings, A.GOOD);
  kpiCard(summary, 0.45, row2, "CAR verified", report.carVerified, A.RED);
  kpiCard(summary, 0.45 + gap, row2, "Critical", report.severityBreakdown.critical, A.RED);
  kpiCard(summary, 0.45 + gap * 2, row2, "High", report.severityBreakdown.high, A.HIGH);
  kpiCard(summary, 0.45 + gap * 3, row2, "Not Fixed", report.statusBreakdown.notFixed, A.HIGH);

  // Slide 3 — Severity + status charts (§28.5/§28.6)
  const chartsSlide = newSlide();
  addHeader(chartsSlide, "Severity & Status", "Distribution from the same report snapshot");
  chartsSlide.addChart("doughnut", [
    {
      name: "Severity",
      labels: ["Critical", "High", "Medium", "Low", "Info"],
      values: [report.severityBreakdown.critical, report.severityBreakdown.high, report.severityBreakdown.medium, report.severityBreakdown.low, report.severityBreakdown.info],
    },
  ], { x: 0.5, y: 1.6, w: 6, h: 4.8, chartColors: [A.RED, A.HIGH, A.MEDIUM, A.LOW, "9E9E9E"], showLegend: true, legendPos: "b", showTitle: true, title: "Severity distribution", titleFontFace: "Bebas Neue", titleFontSize: 16, titleColor: A.INK });
  chartsSlide.addChart("bar", [
    { name: "Findings", labels: ["Open/Pending", "Fixed", "Not Fixed", "Reopened", "CAR"], values: [report.statusBreakdown.open, report.statusBreakdown.fixed, report.statusBreakdown.notFixed, report.statusBreakdown.reopened, report.statusBreakdown.car] },
  ], { x: 6.9, y: 1.6, w: 5.9, h: 4.8, barDir: "bar", chartColors: [A.LOW], showValue: true, dataLabelColor: A.INK, showTitle: true, title: "Status distribution", titleFontFace: "Bebas Neue", titleFontSize: 16, titleColor: A.INK });

  // Slide 4 — Application overview table (§28.4)
  const appsSlide = newSlide();
  addHeader(appsSlide, "Application Register", `${report.applications.length} applications · authoritative counts`);
  const headerRow: TableLike[] = ["Application", "Type", "Status", "Total", "Crit", "High", "Med", "Low", "Pending", "Fixed"].map((h) => ({ text: h, options: { bold: true, color: A.WHITE, fill: { color: A.INK }, fontFace: "Poppins", fontSize: 10 } }));
  const bodyRows: TableLike[][] = report.applications.slice(0, 29).map((a) => [
    { text: a.displayName.slice(0, 28), options: { fontFace: "Poppins", fontSize: 9, color: A.INK } },
    { text: a.typeName, options: { fontFace: "Poppins", fontSize: 9, color: "444444" } },
    { text: a.statusLabel, options: { fontFace: "Poppins", fontSize: 9, color: "444444" } },
    { text: String(a.counts.total), options: { fontFace: "Poppins", fontSize: 9 } },
    { text: String(a.counts.critical), options: { fontFace: "Poppins", fontSize: 9, color: a.counts.critical ? A.RED : "666666" } },
    { text: String(a.counts.high), options: { fontFace: "Poppins", fontSize: 9, color: a.counts.high ? A.HIGH : "666666" } },
    { text: String(a.counts.medium), options: { fontFace: "Poppins", fontSize: 9, color: a.counts.medium ? A.MEDIUM : "666666" } },
    { text: String(a.counts.low), options: { fontFace: "Poppins", fontSize: 9, color: "666666" } },
    { text: String(a.counts.pending), options: { fontFace: "Poppins", fontSize: 9 } },
    { text: String(a.counts.fixed), options: { fontFace: "Poppins", fontSize: 9 } },
  ]);
  appsSlide.addTable([headerRow, ...bodyRows], { x: 0.35, y: 1.45, w: 12.6, colW: [1.9, 0.8, 0.9, 0.7, 0.7, 0.7, 0.7, 0.7, 0.9, 0.8], border: { pt: 0.5, color: A.STROKE }, rowH: 0.3 });

  // Slide 5 — Remediation focus (§28.10/§28.12/§28.14)
  const remediation = newSlide();
  addHeader(remediation, "Remediation Focus", "Not fixed / reopened findings awaiting attention");
  const notFixedApps = report.applications
    .filter((a) => a.counts.pending > 0 || a.counts.reopened > 0)
    .slice(0, 10);
  if (notFixedApps.length === 0) {
    remediation.addText("No pending remediation indicates open items — empty state per data.", { x: 0.5, y: 2.2, w: 12, h: 0.5, fontFace: "Poppins", fontSize: 12, color: A.MUTED });
  } else {
    const nfRows: TableLike[][] = [
      ["Application", "Pending", "Not Fixed", "Reopened", "CAR", "Latest Iteration"].map((h) => ({ text: h, options: { bold: true, color: A.WHITE, fill: { color: A.INK }, fontFace: "Poppins", fontSize: 10 } })),
    ];
    for (const a of notFixedApps) {
      nfRows.push([
        { text: a.displayName.slice(0, 34), options: { fontFace: "Poppins", fontSize: 10, color: A.INK } },
        { text: String(a.counts.pending), options: { fontFace: "Poppins", fontSize: 10 } },
        { text: String(a.counts.notFixed), options: { fontFace: "Poppins", fontSize: 10, color: a.counts.notFixed ? A.RED : "666666" } },
        { text: String(a.counts.reopened), options: { fontFace: "Poppins", fontSize: 10, color: a.counts.reopened ? A.HIGH : "666666" } },
        { text: String(a.counts.car), options: { fontFace: "Poppins", fontSize: 10 } },
        { text: a.latestIteration ? `I${a.latestIteration}` : "—", options: { fontFace: "Poppins", fontSize: 10, color: "666666" } },
      ]);
    }
    remediation.addTable(nfRows, { x: 0.4, y: 1.5, w: 12.5, colW: [3.6, 1.2, 1.4, 1.4, 1.0, 1.6], border: { pt: 0.5, color: A.STROKE }, rowH: 0.32 });
  }

  // Slide 6 — Scan timeline, remediation status and cumulative findings.
  const timeline = newSlide();
  addHeader(timeline, "Scan Timeline & Cumulative Findings", "Scan/report dates oldest to newest · same report snapshot as Dashboard");
  const insightDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");
  timeline.addText(
    `${report.insights.datedApplications} dated applications · earliest ${insightDate(report.insights.earliestScanDate)} · latest ${insightDate(report.insights.latestScanDate)} · average request-to-report ${report.insights.averageRequestedToReportDays === null ? "—" : `${report.insights.averageRequestedToReportDays} days`} · ${report.insights.applicationsWithPendingRemediation} applications with pending remediation`,
    { x: 0.5, y: 1.42, w: 12.3, h: 0.45, fontFace: "Poppins", fontSize: 11, color: A.MUTED },
  );
  const timelineApps = report.applications
    .filter((a) => a.scanReportDate)
    .sort((a, b) => new Date(a.scanReportDate!).getTime() - new Date(b.scanReportDate!).getTime());
  if (report.cumulativeFindings.length === 0) {
    timeline.addText("No scan/report dates are available for the cumulative view.", { x: 0.5, y: 2.3, w: 12, h: 0.4, fontFace: "Poppins", fontSize: 12, color: A.MUTED });
  } else {
    timeline.addChart("line", [
      { name: "Cumulative findings", labels: report.cumulativeFindings.map((point) => point.label), values: report.cumulativeFindings.map((point) => point.cumulativeFindings) },
    ], { x: 0.5, y: 2.05, w: 6.0, h: 4.8, lineWidth: 3, showTitle: true, title: "Cumulative findings", titleFontFace: "Bebas Neue", titleFontSize: 16, titleColor: A.INK });
  }
  timeline.addChart("bar", [
    {
      name: "Findings by application",
      labels: timelineApps.map((a) => `${a.displayName.slice(0, 22)} · ${insightDate(a.scanReportDate)}`),
      values: timelineApps.map((a) => a.counts.total),
    },
  ], { x: 6.85, y: 2.05, w: 6.0, h: 4.8, barDir: "bar", chartColors: [A.HIGH], showValue: true, dataLabelColor: A.INK, showTitle: true, title: "Scan timeline — findings by application", titleFontFace: "Bebas Neue", titleFontSize: 16, titleColor: A.INK });

  void slideIndex;

  const written = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const generatedBuffer = Buffer.from(written);
  const buffer = templateBuffer ?? generatedBuffer;

  // §34/§35 validation
  const validation = await validateGeneratedDeck(buffer, {
    total: report.totalFindings,
    pending: report.pendingFindings,
    closed: report.closedFindings,
    car: report.carVerified,
    slideCount: templateBuffer ? await countSlidesInBuffer(buffer) : slideCount,
  });
  if (!validation.ok) {
    await recordAudit({
      action: "ppt_export.validation_failed",
      entityType: "ExportJob",
      newValue: JSON.stringify({ problems: validation.problems }),
      source: "SYSTEM",
      actorUserId: params.userId,
    });
    throw new AppError("VALIDATION_ERROR", 422, `Generated deck failed validation: ${validation.problems.join("; ")}`);
  }

  const filename = params.filters.applicationId
    ? `VAPT_${sanitizeReportSegment(report.applications.find((a) => a.id === params.filters.applicationId)?.displayName ?? "Application")}_${report.generatedAt.slice(0, 10)}.pptx`
    : `VAPT_Report_${report.generatedAt.slice(0, 10)}.pptx`;

  const completed = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "completed" } } });
  if (!completed) throw NotFoundError("job_status/completed");
  const job = await prisma.exportJob.create({
    data: {
      filename,
      target: "pptx",
      status: completed.id,
      params: {
        filters: params.filters,
        templateSource: templateBuffer ? "uploaded-template" : "builtin",
        reportSnapshot: {
          generatedAt: report.generatedAt,
          total: report.totalFindings,
          pending: report.pendingFindings,
          closed: report.closedFindings,
          car: report.carVerified,
          severity: report.severityBreakdown,
        },
      } as never,
      startedAt: new Date(report.generatedAt),
      completedAt: new Date(),
      rowsProcessed: report.applications.length,
      createdByUserId: params.userId,
    },
  });

  await recordAudit({
    action: "ppt_export.completed",
    entityType: "ExportJob",
    entityId: job.id,
    newValue: JSON.stringify({ filename, applications: report.applications.length, findings: report.totalFindings }),
    source: "HUMAN",
    actorUserId: params.userId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });

  return { buffer, filename, jobId: job.id, validation };
}
