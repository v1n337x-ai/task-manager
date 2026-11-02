/**
 * Per-iteration application summaries (Reports screen, user-requested).
 * For one application: every iteration of every engagement (I1, I2, I3 …)
 * with LIVE finding counts computed from finding_iteration_states — reusing
 * the exact Open/Closed semantics of the Excel export service so a number on
 * screen always equals the same number in the workbook.
 */
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

export interface IterationSummaryRow {
  iterationId: number;
  iterationNumber: number;
  engagementName: string;
  name: string;
  typeLabel: string;
  statusLabel: string;
  startDate: string | null;
  reportDate: string | null;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
    open: number;
    fixed: number;
    notFixed: number;
    reopened: number;
    closed: number;
    car: number;
  };
  testCases: number;
}

/** Buckets IDENTICAL to lib/excel/export-service.ts (single source of truth). */
const OPEN_STATUSES = new Set(["open", "new", "in_progress", "not_retested"]);
const FIXED = "fixed";
const NOT_FIXED = "not_fixed";
const REOPENED = "reopened";
const CAR = "accepted_risk";
const CLOSED_SET = new Set([FIXED, NOT_FIXED, REOPENED, CAR, "out_of_scope", "removed"]);

export interface ApplicationIterationSummary {
  application: {
    id: number;
    displayName: string;
    name: string;
    webUrl: string | null;
    typeLabel: string;
    statusLabel: string;
  };
  iterations: IterationSummaryRow[];
}

export async function getApplicationIterationSummaries(applicationId: number): Promise<ApplicationIterationSummary> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, displayName: true, name: true, webUrl: true, applicationTypeRef: { select: { label: true } }, statusRef: { select: { label: true } } },
  });
  if (!application) throw NotFoundError("Application");

  const iterations = await prisma.iteration.findMany({
    where: { engagement: { applicationId } },
    orderBy: [{ engagementId: "asc" }, { number: "asc" }],
    include: {
      engagement: { select: { name: true } },
      iterationTypeRef: { select: { label: true } },
      statusRef: { select: { label: true } },
      testCases: { select: { id: true } },
      findingStates: { select: { severityRef: { select: { value: true } }, statusRef: { select: { value: true } } } },
    },
  });

  // Contract cap (user-directed 2026-11): summaries show exactly I1 and I2.
  const capped = iterations.filter((it) => it.number <= 2);

  const rows: IterationSummaryRow[] = capped.map((it) => {
    const counts = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0,
      total: it.findingStates.length,
      open: 0, fixed: 0, notFixed: 0, reopened: 0, closed: 0, car: 0,
    };
    for (const fs of it.findingStates) {
      const sev = fs.severityRef.value;
      if (sev === "critical") counts.critical += 1;
      else if (sev === "high") counts.high += 1;
      else if (sev === "medium") counts.medium += 1;
      else if (sev === "low") counts.low += 1;
      else counts.info += 1;

      const st = fs.statusRef.value;
      if (OPEN_STATUSES.has(st)) counts.open += 1;
      if (st === FIXED) counts.fixed += 1;
      if (st === NOT_FIXED) counts.notFixed += 1;
      if (st === REOPENED) counts.reopened += 1;
      if (st === CAR) counts.car += 1;
      if (CLOSED_SET.has(st)) counts.closed += 1;
    }
    return {
      iterationId: it.id,
      iterationNumber: it.number,
      engagementName: it.engagement.name,
      name: it.name,
      typeLabel: it.iterationTypeRef.label,
      statusLabel: it.statusRef.label,
      startDate: it.startDate ? it.startDate.toISOString() : null,
      reportDate: it.reportDate ? it.reportDate.toISOString() : null,
      counts,
      testCases: it.testCases.length,
    };
  });

  return {
    application: {
      id: application.id,
      displayName: application.displayName,
      name: application.name,
      webUrl: application.webUrl,
      typeLabel: application.applicationTypeRef.label,
      statusLabel: application.statusRef.label,
    },
    iterations: rows,
  };
}
