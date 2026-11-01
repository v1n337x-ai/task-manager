/**
 * Centralized reporting layer (Phase 7 §4-§5). ONE source of truth: every
 * surface (dashboard, reports, PPT) consumes the same typed snapshot built
 * here from live authoritative database state — never hardcoded values,
 * never Excel snapshots, never AI narrative numbers.
 */
import { prisma } from "@/lib/db";

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
  lastActivity: string | null;
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
      engagements: { include: { iterations: { orderBy: { number: "desc" } } } },
    },
    orderBy: { name: "asc" },
  });

  const findings = await prisma.finding.findMany({
    where: { application: appWhere, isActive: true },
    select: {
      id: true,
      applicationId: true,
      severityRef: { select: { value: true } },
      statusRef: { select: { value: true } },
      iterationStates: { include: { iteration: { select: { number: true } }, statusRef: { select: { value: true } } } },
    },
  });
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
      lastActivity: (a.updatedAt ?? null)?.toISOString() ?? null,
    };
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
