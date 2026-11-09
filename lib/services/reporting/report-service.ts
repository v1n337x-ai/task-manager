/**
 * Centralized reporting layer (Phase 7 §4-§5). ONE source of truth: every
 * surface (dashboard, reports, PPT) consumes the same typed snapshot built
 * here from live authoritative database state — never hardcoded values,
 * never Excel snapshots, never AI narrative numbers.
 */
import { prisma } from "@/lib/db";
import { duplicateMasterPlaceholderIds } from "@/lib/services/finding-placeholder-utils";

export interface SeverityBreakdown {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ApplicationReport {
  id: number;
  displayName: string;
  typeName: string;
  scopeLabel: string;
  statusLabel: string;
  target: string | null;
  counts: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    pending: number;
    fixed: number;
    notFixed: number;
    reopened: number;
    car: number;
    newInLatestIteration: number;
    testCases: number;
  };
  latestIteration: number | null;
  requestedDate: string | null;
  scanReportDate: string | null;
  closureRate: number | null;
  milestones: { iteration: number; reportDate: string | null; statusLabel: string }[];
  lastActivity: string | null;
}

export interface CumulativeFindingPoint {
  month: string;
  label: string;
  applications: number;
  findingsThisMonth: number;
  cumulativeFindings: number;
}

export interface DashboardInsights {
  datedApplications: number;
  missingDateApplications: number;
  earliestScanDate: string | null;
  latestScanDate: string | null;
  averageRequestedToReportDays: number | null;
  applicationsWithPendingRemediation: number;
  oldestPendingApplication: string | null;
}

export interface DashboardReport {
  generatedAt: string;
  totalApplications: number;
  totalFindings: number;
  pendingFindings: number;
  closedFindings: number;
  carVerified: number;
  severityBreakdown: SeverityBreakdown;
  statusBreakdown: { open: number; fixed: number; notFixed: number; reopened: number; car: number };
  applications: ApplicationReport[];
  cumulativeFindings: CumulativeFindingPoint[];
  insights: DashboardInsights;
  iterationBreakdown: { iteration: number; applications: number }[];
  recentActivity: { at: string; action: string; entityType: string; entityId: string; source: string }[];
}

export interface ReportFilters {
  applicationId?: number;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  statusValue?: string;
  iterationNumber?: number;
}

export function validateSeverity(s: string | undefined): ReportFilters["severity"] {
  if (!s) return undefined;
  return ["critical", "high", "medium", "low", "info"].includes(s) ? (s as ReportFilters["severity"]) : undefined;
}

export type { ReportFilters as FiltersAlias };

const OPEN_STATES = ["open", "new", "not_fixed", "not_retested"];

export async function generateDashboardReport(filters: ReportFilters = {}): Promise<DashboardReport> {
  const appWhere = {
    isActive: true,
    ...(filters.applicationId ? { id: filters.applicationId } : {}),
  };

  const apps = await prisma.application.findMany({
    where: appWhere,
    include: {
      applicationTypeRef: true,
      scopeRef: true,
      statusRef: true,
      engagements: {
        include: {
          statusRef: true,
          iterations: { orderBy: { number: "desc" }, include: { statusRef: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const allFindings = await prisma.finding.findMany({
    where: { application: appWhere, isActive: true },
    select: {
      id: true,
      applicationId: true,
      title: true,
      description: true,
      severityRef: { select: { value: true } },
      statusRef: { select: { value: true } },
      iterationStates: { include: { iteration: { select: { number: true } }, statusRef: { select: { value: true } } } },
    },
  });
  const duplicatePlaceholderIds = duplicateMasterPlaceholderIds(allFindings, (f) => f.applicationId);
  const findings = allFindings.filter((f) => !duplicatePlaceholderIds.has(f.id));
  const testCases = await prisma.testCase.groupBy({ by: ["applicationId"], where: { application: appWhere }, _count: { _all: true } });
  const tcByApp = new Map(testCases.map((t) => [t.applicationId, t._count._all]));

  const filtered = filters.severity || filters.statusValue || filters.iterationNumber
    ? findings.filter((f) => {
        const current = f.iterationStates.length
          ? f.iterationStates.reduce((a, b) => (b.iteration.number > a.iteration.number ? b : a)).statusRef.value
          : f.statusRef.value;
        if (filters.severity && f.severityRef.value !== filters.severity) return false;
        if (filters.statusValue && current !== filters.statusValue) return false;
        if (filters.iterationNumber && !f.iterationStates.some((s) => s.iteration.number === filters.iterationNumber)) return false;
        return true;
      })
    : findings;

  const severityBreakdown: SeverityBreakdown = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const statusBreakdown = { open: 0, fixed: 0, notFixed: 0, reopened: 0, car: 0 };
  const perApp = new Map<number, ApplicationReport["counts"] & { lastActivity: Date | null }>();
  const emptyCounts = () => ({ total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, pending: 0, fixed: 0, notFixed: 0, reopened: 0, car: 0, newInLatestIteration: 0, testCases: 0, lastActivity: null as Date | null });

  for (const f of filtered) {
    const counts = perApp.get(f.applicationId) ?? emptyCounts();
    const current = f.iterationStates.length
      ? f.iterationStates.reduce((a, b) => (b.iteration.number > a.iteration.number ? b : a))
      : null;
    const currentStatus = current ? current.statusRef.value : f.statusRef.value;

    severityBreakdown[f.severityRef.value as keyof SeverityBreakdown] += 1;
    counts.total += 1;
    counts[f.severityRef.value as "critical" | "high" | "medium" | "low" | "info"] += 1;
    if (OPEN_STATES.includes(currentStatus)) {
      counts.pending += 1;
      statusBreakdown.open += 1;
      if (currentStatus === "not_fixed") { statusBreakdown.notFixed += 1; counts.notFixed += 1; }
    }
    if (currentStatus === "fixed") { counts.fixed += 1; statusBreakdown.fixed += 1; }
    if (currentStatus === "reopened") { counts.reopened += 1; statusBreakdown.reopened += 1; }
    if (currentStatus === "accepted_risk") { counts.car += 1; statusBreakdown.car += 1; }
    if (current && current.statusRef.value === "new" && f.iterationStates.length === 1) counts.newInLatestIteration += 1;
    perApp.set(f.applicationId, counts);
  }

  const appRows: ApplicationReport[] = apps.map((a) => {
    const engagement = a.engagements[0];
    const counts = perApp.get(a.id) ?? emptyCounts();
    const tcCount = tcByApp.get(a.id) ?? 0;
    const latest = engagement?.iterations?.[0];
    return {
      id: a.id,
      displayName: a.displayName,
      typeName: a.applicationTypeRef.label,
      scopeLabel: a.scopeRef.label,
      statusLabel: a.statusRef.label,
      target: a.webUrl ?? a.apiFqdn ?? a.rawTarget,
      counts: {
        total: counts.total,
        critical: counts.critical,
        high: counts.high,
        medium: counts.medium,
        low: counts.low,
        info: counts.info,
        pending: counts.pending,
        fixed: counts.fixed,
        notFixed: counts.notFixed,
        reopened: counts.reopened,
        car: counts.car,
        newInLatestIteration: counts.newInLatestIteration,
        testCases: tcCount,
      },
      latestIteration: latest?.number ?? 0,
      requestedDate: engagement?.requestedDate?.toISOString() ?? null,
      scanReportDate: engagement?.reportDate?.toISOString() ?? null,
      closureRate: counts.total ? Math.round((counts.fixed / counts.total) * 1000) / 10 : null,
      milestones: [...(engagement?.iterations ?? [])]
        .sort((a, b) => a.number - b.number)
        .filter((iteration) => iteration.number <= 2)
        .map((iteration) => ({
          iteration: iteration.number,
          reportDate: iteration.reportDate?.toISOString() ?? null,
          statusLabel: iteration.statusRef.label,
        })),
      lastActivity: (a.updatedAt ?? null)?.toISOString() ?? null,
    };
  });

  const datedApplications = appRows.filter((a) => a.scanReportDate);
  const chronologicalApplications = [...datedApplications].sort(
    (a, b) => new Date(a.scanReportDate!).getTime() - new Date(b.scanReportDate!).getTime(),
  );
  const durationDays = appRows.flatMap((a) => {
    if (!a.requestedDate || !a.scanReportDate) return [];
    const days = Math.floor((new Date(a.scanReportDate).getTime() - new Date(a.requestedDate).getTime()) / 86_400_000);
    return days >= 0 ? [days] : [];
  });
  const pendingApplications = appRows.filter((a) => a.counts.pending > 0);
  const oldestPendingApplication = [...pendingApplications]
    .sort((a, b) => {
      const aTime = a.scanReportDate ? new Date(a.scanReportDate).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.scanReportDate ? new Date(b.scanReportDate).getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    })[0]?.displayName ?? null;
  const insights: DashboardInsights = {
    datedApplications: datedApplications.length,
    missingDateApplications: appRows.length - datedApplications.length,
    earliestScanDate: chronologicalApplications[0]?.scanReportDate ?? null,
    latestScanDate: chronologicalApplications.at(-1)?.scanReportDate ?? null,
    averageRequestedToReportDays:
      durationDays.length ? Math.round((durationDays.reduce((sum, days) => sum + days, 0) / durationDays.length) * 10) / 10 : null,
    applicationsWithPendingRemediation: pendingApplications.length,
    oldestPendingApplication,
  };

  const monthlyScanActivity = new Map<string, { applications: number; findings: number }>();
  for (const application of chronologicalApplications) {
    const monthDate = new Date(application.scanReportDate!);
    const month = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const current = monthlyScanActivity.get(month) ?? { applications: 0, findings: 0 };
    current.applications += 1;
    current.findings += application.counts.total;
    monthlyScanActivity.set(month, current);
  }
  let cumulativeFindingsTotal = 0;
  const cumulativeFindings: CumulativeFindingPoint[] = [...monthlyScanActivity.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, values]) => {
      cumulativeFindingsTotal += values.findings;
      const [year, monthNumber] = month.split("-").map(Number);
      const label = new Date(Date.UTC(year!, monthNumber! - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
      return { month, label, applications: values.applications, findingsThisMonth: values.findings, cumulativeFindings: cumulativeFindingsTotal };
    });

  const iterationSet = new Map<number, number>();
  for (const a of apps) {
    const latest = a.engagements[0]?.iterations?.[0];
    if (latest) iterationSet.set(latest.number, (iterationSet.get(latest.number) ?? 0) + 1);
  }

  const recent = await prisma.auditLog.findMany({
    where: { action: { in: ["application.create", "application.update", "finding.create", "state_decision.recorded", "iteration.create", "ai_extraction.decision"] } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  return {
    generatedAt: new Date().toISOString(),
    totalApplications: apps.length,
    totalFindings: filtered.length,
    pendingFindings: filtered.filter((f) => {
      const current = f.iterationStates.length
        ? f.iterationStates.reduce((a, b) => (b.iteration.number > a.iteration.number ? b : a)).statusRef.value
        : f.statusRef.value;
      return OPEN_STATES.includes(current);
    }).length,
    closedFindings: filtered.filter((f) => {
      const current = f.iterationStates.length
        ? f.iterationStates.reduce((a, b) => (b.iteration.number > a.iteration.number ? b : a)).statusRef.value
        : f.statusRef.value;
      return current === "fixed";
    }).length,
    carVerified: filtered.filter((f) => {
      const current = f.iterationStates.length
        ? f.iterationStates.reduce((a, b) => (b.iteration.number > a.iteration.number ? b : a)).statusRef.value
        : f.statusRef.value;
      return current === "accepted_risk";
    }).length,
    severityBreakdown,
    statusBreakdown,
    applications: appRows,
    cumulativeFindings,
    insights,
    iterationBreakdown: [...iterationSet.entries()].sort((a, b) => a[0] - b[0]).map(([iteration, applications]) => ({ iteration, applications })),
    recentActivity: recent.map((r) => ({
      at: r.createdAt.toISOString(),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId ?? "",
      source: r.source,
    })),
  };
}

export function sanitizeReportSegment(input: string): string {
  return input.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Report";
}
