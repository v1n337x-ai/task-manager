/**
 * PT Tracker service (Phase 3 §4-§22, §41-§42, §56-§57).
 * All counts derive from finding/iteration-state records (§36/§37/§56) —
 * the current state is the LATEST authoritative iteration state (§19).
 */
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { duplicateMasterPlaceholderIds } from "@/lib/services/finding-placeholder-utils";

export interface TrackerIterationInfo {
  number: number;
  name: string;
  typeLabel: string;
  statusLabel: string;
  startDate: Date | null;
  reportDate: Date | null;
}

export interface TrackerAppRow {
  id: number;
  sNo: number | null;
  name: string;
  displayName: string;
  typeName: string;
  scopeLabel: string;
  environmentLabel: string;
  statusLabel: string;
  overallStatusLabel: string; // engagement status — Excel "Overall Status"
  target: string | null;
  assessmentTypeLabel: string;
  engagementName: string | null;
  mailSubject: string | null; // Excel "Mail Subject"
  poc: string | null; // Excel "POC Task Manager"
  assignedMembers: string | null; // Excel "Security Vendor Team - Assigned member"
  requestedDate: Date | null; // Excel "Requested date"
  reportDate: Date | null; // Excel "Scan/Report Date"
  comments: string | null; // Excel "Comments"
  latestIteration: { number: number; name: string; typeLabel: string; statusLabel: string } | null;
  /** ALL iterations ascending (floaters show every I1..In including >2). */
  iterations: TrackerIterationInfo[];
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
    car: number;
    newInLatestIteration: number;
    testCases: number;
  };
  /** Excel Open/Closed matrix pairs (AE..AN semantics — identical buckets). */
  openBySeverity: { critical: number; high: number; medium: number; low: number; info: number };
  closedBySeverity: { critical: number; high: number; medium: number; low: number; info: number };
  /** Excel "Vulnerabilities  Closed" (fixed only). */
  closed: number;
  active: boolean;
  updatedAt: Date;
}

const OPEN_STATES = ["open", "new", "not_fixed", "not_retested"];
const FIXED_STATES = ["fixed"];

/** Aggregated tracker rows (single batch of queries — no N+1, §57). */
export async function listTrackerApps(filters: {
  q?: string;
  type?: string;
  status?: string;
  scope?: string;
  severity?: string;
  fixedState?: "fixed" | "not_fixed" | "new" | "pending";
  iterationNumber?: number;
  sort?: "name" | "scanDate" | "total" | "critical" | "high";
}): Promise<TrackerAppRow[]> {
  const apps = await prisma.application.findMany({
    where: {
      ...(filters.q ? { OR: [{ name: { contains: filters.q } }, { displayName: { contains: filters.q } }, { webUrl: { contains: filters.q } }, { apiFqdn: { contains: filters.q } }] } : {}),
      ...(filters.type ? { applicationTypeRef: { value: filters.type } } : {}),
      ...(filters.scope ? { scopeRef: { value: filters.scope } } : {}),
      ...(filters.status ? { statusRef: { value: filters.status } } : {}),
    },
    include: {
      applicationTypeRef: true,
      scopeRef: true,
      environmentRef: true,
      statusRef: true,
      primaryPoc: { select: { fullName: true } },
      assignedMembers: { include: { contact: { select: { fullName: true } } } },
      engagements: {
        include: {
          sourceRef: true,
          statusRef: true,
          scopeRef: true,
          iterations: {
            where: filters.iterationNumber ? { number: filters.iterationNumber } : undefined,
            orderBy: { number: "desc" },
            include: { iterationTypeRef: true, statusRef: true },
          },
        },
      },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const findings = await prisma.finding.findMany({
    where: {},
    select: {
      id: true,
      applicationId: true,
      isActive: true,
      title: true,
      description: true,
      severityRef: { select: { value: true } },
      statusRef: { select: { value: true } },
      iterationStates: {
        include: { iteration: { select: { number: true } }, statusRef: { select: { value: true } } },
      },
    },
  });
  const duplicatePlaceholderIds = duplicateMasterPlaceholderIds(findings, (f) => f.applicationId);
  const testCases = await prisma.testCase.groupBy({ by: ["applicationId"], _count: { _all: true } });
  const tcCountByApp = new Map(testCases.map((t) => [t.applicationId, t._count._all]));

  const result: TrackerAppRow[] = [];
  for (const app of apps) {
    const engagement = app.engagements[0];
    const iterations = engagement?.iterations ?? [];
    const latest = iterations[0];
    const appFindings = findings.filter((f) => f.applicationId === app.id && !duplicatePlaceholderIds.has(f.id));
    const relevant = appFindings.filter((f) => f.isActive);

    const row: TrackerAppRow = {
      id: app.id,
      sNo: engagement?.sortOrder ?? null,
      name: app.name,
      displayName: app.displayName,
      typeName: app.applicationTypeRef.label,
      scopeLabel: app.scopeRef.label,
      environmentLabel: app.environmentRef.label,
      statusLabel: app.statusRef.label,
      overallStatusLabel: engagement?.statusRef?.label ?? "—",
      target: app.webUrl ?? app.apiFqdn ?? app.rawTarget,
      assessmentTypeLabel: engagement?.sourceRef?.label ?? "—",
      engagementName: engagement?.name ?? null,
      mailSubject: engagement?.mailSubject ?? null,
      poc: app.primaryPoc?.fullName ?? null,
      assignedMembers: app.assignedMembers.length ? app.assignedMembers.map((m) => m.contact.fullName).join(" / ") : null,
      requestedDate: engagement?.requestedDate ?? null,
      reportDate: engagement?.reportDate ?? null,
      comments: engagement?.notes ?? null,
      latestIteration: latest
        ? { number: latest.number, name: latest.name, typeLabel: latest.iterationTypeRef.label, statusLabel: latest.statusRef.label }
        : null,
      iterations: [...(engagement?.iterations ?? [])]
        .filter((it) => it.number <= 2)
        .sort((a, b) => a.number - b.number)
        .map((it) => ({
          number: it.number,
          name: it.name,
          typeLabel: it.iterationTypeRef.label,
          statusLabel: it.statusRef.label,
          startDate: it.startDate,
          reportDate: it.reportDate,
        })),      counts: {
        total: relevant.length,
        critical: relevant.filter((f) => f.severityRef.value === "critical").length,
        high: relevant.filter((f) => f.severityRef.value === "high").length,
        medium: relevant.filter((f) => f.severityRef.value === "medium").length,
        low: relevant.filter((f) => f.severityRef.value === "low").length,
        info: relevant.filter((f) => f.severityRef.value === "info").length,
        pending: relevant.filter((f) => OPEN_STATES.includes(f.statusRef.value)).length,
        fixed: relevant.filter((f) => FIXED_STATES.includes(f.statusRef.value)).length,
        notFixed: relevant.filter((f) => f.statusRef.value === "not_fixed").length,
        car: relevant.filter((f) => f.statusRef.value === "accepted_risk").length,
        newInLatestIteration: latest
          ? relevant.filter((f) => {
              const state = f.iterationStates.find((s) => s.iteration.number === latest.number);
              return state?.statusRef.value === "new";
            }).length
          : 0,
        testCases: tcCountByApp.get(app.id) ?? 0,
      },
      active: app.isActive,
      updatedAt: app.updatedAt,
      openBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      closedBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      closed: 0,
    };

    // Excel Open/Closed matrix (AE..AN) — buckets IDENTICAL to export-service.
    const openBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const closedBySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    let closedCount = 0;
    for (const f of relevant) {
      const sev = f.severityRef.value;
      const st = f.statusRef.value;
      if (OPEN_STATES.includes(st)) {
        openBySeverity[sev as keyof typeof openBySeverity] += 1;
      } else if (st === "fixed") {
        closedBySeverity[sev as keyof typeof closedBySeverity] += 1;
        closedCount += 1;
      }
    }
    row.openBySeverity = openBySeverity;
    row.closedBySeverity = closedBySeverity;
    row.closed = closedCount;

    if (filters.severity) {
      const sev = filters.severity;
      if ((sev === "critical" && row.counts.critical === 0) || (sev === "high" && row.counts.high === 0) || (sev === "medium" && row.counts.medium === 0) || (sev === "low" && row.counts.low === 0)) {
        continue;
      }
    }
    if (filters.fixedState === "fixed" && row.counts.fixed === 0) continue;
    if (filters.fixedState === "not_fixed" && row.counts.notFixed === 0) continue;
    if (filters.fixedState === "new" && row.counts.newInLatestIteration === 0) continue;
    if (filters.fixedState === "pending" && row.counts.pending === 0) continue;
    if (filters.iterationNumber && row.latestIteration?.number !== filters.iterationNumber) continue;

    result.push(row);
  }
  // S.No is always chronological by scan/report date (oldest first), while
  // user-selected table ordering below can still rearrange the display.
  result.sort((a, b) => {
    const ta = a.reportDate ? new Date(a.reportDate).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.reportDate ? new Date(b.reportDate).getTime() : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.displayName.localeCompare(b.displayName);
  });
  result.forEach((row, index) => {
    row.sNo = index + 1;
  });

  // Optional sort (S.No stays fixed — it lives on the row, not the index).
  const sort = filters.sort;
  if (sort && sort !== "name") {
    result.sort((a, b) => {
      if (sort === "scanDate") {
        const ta = a.reportDate ? new Date(a.reportDate).getTime() : 0;
        const tb = b.reportDate ? new Date(b.reportDate).getTime() : 0;
        return tb - ta; // newest first
      }
      if (sort === "total") return b.counts.total - a.counts.total;
      if (sort === "critical") return b.counts.critical - a.counts.critical;
      if (sort === "high") return b.counts.high - a.counts.high;
      return 0;
    });
  }
  return result;
}

/** Totals across the registry (§56). */
export function summarize(rows: TrackerAppRow[]) {
  return rows.reduce(
    (acc, r) => ({
      applications: acc.applications + 1,
      total: acc.total + r.counts.total,
      critical: acc.critical + r.counts.critical,
      high: acc.high + r.counts.high,
      medium: acc.medium + r.counts.medium,
      low: acc.low + r.counts.low,
      info: acc.info + r.counts.info,
      pending: acc.pending + r.counts.pending,
      fixed: acc.fixed + r.counts.fixed,
      notFixed: acc.notFixed + r.counts.notFixed,
      car: acc.car + r.counts.car,
      newInLatestIteration: acc.newInLatestIteration + r.counts.newInLatestIteration,
      testCases: acc.testCases + r.counts.testCases,
    }),
    {
      applications: 0,
      total: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      pending: 0,
      fixed: 0,
      notFixed: 0,
      car: 0,
      newInLatestIteration: 0,
      testCases: 0,
    },
  );
}

// ---------------------------------------------------------------------------
// Application detail (§8-§11, §47)
// ---------------------------------------------------------------------------

export interface FindingStateCell {
  iterationNumber: number;
  statusValue: string;
  statusLabel: string;
  severityValue: string;
  comment: string | null;
}

export interface TrackerFinding {
  id: number;
  code: string;
  title: string;
  description: string | null;
  severityValue: string;
  currentStatusValue: string;
  currentStatusLabel: string;
  testCaseId: number | null;
  testCaseCode: string | null;
  firstSeenIterationNumber: number | null;
  history: { at: string; oldStatus: string | null; newStatus: string; iterationNumber: number | null; source: string; note: string | null }[];
  iterationStates: FindingStateCell[];
}

export interface TrackerIteration {
  id: number;
  number: number;
  name: string;
  typeLabel: string;
  statusLabel: string;
  startDate: string | null;
  reportDate: string | null;
  importSnapshot: Record<string, unknown> | null;
}

export interface TrackerTestCase {
  id: number;
  code: string;
  title: string;
  category: string | null;
  currentStatusLabel: string;
  isActive: boolean;
  iterations: { iterationNumber: number; status: string; label: string; notes: string | null }[];
}

export interface ApplicationTrackerDetail {
  application: {
    id: number;
    name: string;
    displayName: string;
    typeName: string;
    scopeLabel: string;
    environmentLabel: string;
    statusLabel: string;
    webUrl: string | null;
    apiFqdn: string | null;
    rawTarget: string | null;
    primaryPoc: string | null;
    assignedMembers: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    aliases: { alias: string; normalized: string }[];
  };
  engagement: {
    id: number;
    name: string;
    scopeLabel: string;
    assessmentTypeLabel: string;
    statusLabel: string;
    mailSubject: string | null;
    requestedDate: string | null;
    reportDate: string | null;
    target: string | null;
  } | null;
  iterations: TrackerIteration[];
  findings: TrackerFinding[];
  testCases: TrackerTestCase[];
  totals: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    pending: number;
    fixed: number;
    notFixed: number;
    newInLatestIteration: number;
    testCases: number;
    car: number;
  };
  latestIterationNumber: number | null;
  history: { at: string; action: string; entityType: string; entityId: string; source: string; actorLabel: string | null; detail: string | null }[];
}

/** §19: current state = state of the highest-numbered iteration that has one. */
export function currentStatusFromStates(states: { iterationNumber: number; statusValue: string }[]): string | null {
  if (states.length === 0) return null;
  const latest = states.reduce((a, b) => (b.iterationNumber > a.iterationNumber ? b : a));
  return latest.statusValue;
}

export async function getApplicationTracker(applicationId: number): Promise<ApplicationTrackerDetail> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      applicationTypeRef: true,
      scopeRef: true,
      environmentRef: true,
      statusRef: true,
      primaryPoc: true,
      assignedMembers: { include: { contact: true } },
      aliases: { orderBy: [{ isPrimary: "desc" }, { alias: "asc" }] },
      engagements: {
        include: { sourceRef: true, statusRef: true, scopeRef: true, iterations: { orderBy: { number: "asc" }, include: { iterationTypeRef: true, statusRef: true } } },
      },
    },
  });
  if (!app) throw NotFoundError("Application");
  const engagement = app.engagements[0] ?? null;

  const findings = await prisma.finding.findMany({
    where: { applicationId, isActive: true },
    orderBy: { code: "asc" }, // vapt.xlsx order: # column = F-code order (F-001, F-002, …)
    include: {
      severityRef: true,
      statusRef: true,
      testCase: { select: { code: true } },
      iterationStates: { include: { iteration: { select: { number: true } }, statusRef: true, severityRef: true } },
      history: { orderBy: { createdAt: "asc" }, include: { iteration: { select: { number: true } } } },
    },
  });

  const testCases = await prisma.testCase.findMany({
    where: { applicationId },
    include: {
      statusRef: true,
      iterations: { include: { iteration: { select: { number: true } }, statusRef: true }, orderBy: { iterationId: "asc" } },
    },
  });

  const iterations: TrackerIteration[] = (engagement?.iterations ?? []).map((it) => ({
    id: it.id,
    number: it.number,
    name: it.name,
    typeLabel: it.iterationTypeRef.label,
    statusLabel: it.statusRef.label,
    startDate: it.startDate?.toISOString() ?? null,
    reportDate: it.reportDate?.toISOString() ?? null,
    importSnapshot: (it.importSnapshot ?? null) as Record<string, unknown> | null,
  }));

  const duplicatePlaceholderIds = duplicateMasterPlaceholderIds(findings);
  const trackerFindings: TrackerFinding[] = findings
    .filter((f) => !duplicatePlaceholderIds.has(f.id))
    .filter((f) => f.iterationStates.length > 0 || f.isActive)
    .map((f) => ({
      id: f.id,
      code: f.code,
      title: f.title,
      description: f.description,
      severityValue: f.severityRef.value,
      currentStatusValue: f.statusRef.value,
      currentStatusLabel: f.statusRef.label,
      testCaseId: f.testCaseId,
      testCaseCode: f.testCase?.code ?? null,
      firstSeenIterationNumber: f.firstSeenIterationNumber ?? f.iterationStates[0]?.iteration.number ?? null,
      iterationStates: f.iterationStates
        .map((s) => ({
          iterationNumber: s.iteration.number,
          statusValue: s.statusRef.value,
          statusLabel: s.statusRef.label,
          severityValue: s.severityRef.value,
          comment: s.comments,
        }))
        .sort((a, b) => a.iterationNumber - b.iterationNumber),
      history: f.history.map((h) => ({
        at: h.createdAt.toISOString(),
        oldStatus: h.oldStatusCode,
        newStatus: h.newStatusCode,
        iterationNumber: h.iteration?.number ?? null,
        source: h.source,
        note: h.note,
      })),
    }));

  // Live counts (§11 §56) — current statuses from surface + per-iteration atlas.
  const relevant = trackerFindings;
  const currentOf = (f: TrackerFinding): string =>
    currentStatusFromStates(f.iterationStates.map((s) => ({ iterationNumber: s.iterationNumber, statusValue: s.statusValue }))) ?? f.currentStatusValue;

  const totals = {
    total: relevant.length,
    critical: relevant.filter((f) => f.severityValue === "critical").length,
    high: relevant.filter((f) => f.severityValue === "high").length,
    medium: relevant.filter((f) => f.severityValue === "medium").length,
    low: relevant.filter((f) => f.severityValue === "low").length,
    info: relevant.filter((f) => f.severityValue === "info").length,
    pending: relevant.filter((f) => OPEN_STATES.includes(currentOf(f))).length,
    fixed: relevant.filter((f) => currentOf(f) === "fixed").length,
    notFixed: relevant.filter((f) => currentOf(f) === "not_fixed").length,
    newInLatestIteration: relevant.filter((f) => {
      const latest = f.iterationStates[f.iterationStates.length - 1];
      if (!latest) return false;
      const hasEarlier = f.iterationStates.length > 1;
      return latest.statusValue === "new" && !hasEarlier;
    }).length,
    testCases: testCases.length,
    car: relevant.filter((f) => f.currentStatusValue === "accepted_risk").length,
  };

  // §47 — history: audit entries across this application's entity graph.
  const relatedIds = [
    String(app.id),
    ...(engagement ? [String(engagement.id)] : []),
    ...iterations.map((i) => String(i.id)),
    ...trackerFindings.map((f) => String(f.id)),
    ...testCases.map((t) => String(t.id)),
  ];
  const auditRows = await prisma.auditLog.findMany({
    where: { AND: [{ entityType: { in: ["Application", "Engagement", "Iteration", "Finding", "TestCase", "TestCaseIteration", "ApplicationAlias"] } }, { entityId: { in: relatedIds } }] },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { displayName: true } } },
  });

  return {
    application: {
      id: app.id,
      name: app.name,
      displayName: app.displayName,
      typeName: app.applicationTypeRef.label,
      scopeLabel: app.scopeRef.label,
      environmentLabel: app.environmentRef.label,
      statusLabel: app.statusRef.label,
      webUrl: app.webUrl,
      apiFqdn: app.apiFqdn,
      rawTarget: app.rawTarget,
      primaryPoc: app.primaryPoc?.fullName ?? null,
      assignedMembers: app.assignedMembers.map((m) => m.contact.fullName),
      isActive: app.isActive,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      aliases: app.aliases.map((a) => ({ alias: a.alias, normalized: a.normalized })),
    },
    engagement: engagement
      ? {
          id: engagement.id,
          name: engagement.name,
          scopeLabel: engagement.scopeRef.label,
          assessmentTypeLabel: engagement.sourceRef.label,
          statusLabel: engagement.statusRef.label,
          mailSubject: engagement.mailSubject,
          requestedDate: engagement.requestedDate?.toISOString() ?? null,
          reportDate: engagement.reportDate?.toISOString() ?? null,
          target: engagement.target,
        }
      : null,
    iterations,
    findings: trackerFindings,
    testCases: testCases.map((t) => ({
      id: t.id,
      code: t.code,
      title: t.title,
      category: t.category,
      currentStatusLabel: t.statusRef.label,
      isActive: t.isActive,
      iterations: t.iterations.map((s) => ({
        iterationNumber: s.iteration.number,
        status: s.statusRef.value,
        label: s.statusRef.label,
        notes: s.notes,
      })),
    })),
    totals,
    latestIterationNumber: iterations.length ? iterations[iterations.length - 1]!.number : null,
    history: auditRows.map((a) => ({
      at: a.createdAt.toISOString(),
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId ?? "",
      source: a.source,
      actorLabel: a.actor?.displayName ?? a.actorLabel,
      detail: a.newValue,
    })),
  };
}

/** §55 — helper for iteration UI create: next available number. */
export async function nextIterationNumber(engagementId: number): Promise<number> {
  const last = await prisma.iteration.findFirst({ where: { engagementId }, orderBy: { number: "desc" }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}

/** §55 — status timeline merge (historical preserved — §3 §60). */
export function mergeStatusTimeline(states: FindingStateCell[]): { iterationNumber: number; status: string }[] {
  return states.map((s) => ({ iterationNumber: s.iterationNumber, status: s.statusValue }));
}

