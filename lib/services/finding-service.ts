/**
 * Finding service (brief sections 23-26, 60).
 * Historical state is append-only: setting a new iteration state never touches
 * prior rows; every status change appends a FindingStatusHistory row.
 */
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

export interface CreateFindingInput {
  applicationId: number;
  code?: string; // optional external code (TC-style codes); auto F-### otherwise
  title: string;
  description?: string | null;
  severityValue: "critical" | "high" | "medium" | "low" | "info";
  currentStatusValue?: "open" | "fixed" | "not_fixed" | "accepted_risk" | "removed" | "duplicate";
}

export async function createFinding(input: CreateFindingInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }) {
  const app = await prisma.application.findUnique({ where: { id: input.applicationId } });
  if (!app) throw NotFoundError("Application");

  const [severity, status] = await Promise.all([
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "severity", value: input.severityValue } } }),
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "finding_status", value: input.currentStatusValue ?? "open" } } }),
  ]);
  if (!severity) throw ValidationError("Unknown severity.");
  if (!status) throw ValidationError("Unknown finding status.");

  // Auto-code: F-001.. per application, sparse-code tolerant (counts existing).
  let code = input.code?.trim();
  if (code) {
    const dup = await prisma.finding.findUnique({ where: { applicationId_code: { applicationId: app.id, code } } });
    if (dup) throw ConflictError(`Finding code ${code} already exists for this application.`);
  } else {
    const count = await prisma.finding.count({ where: { applicationId: app.id } });
    let attempt = count + 1;
    // Skip collisions (deleted rows could leave gaps).
    for (;;) {
      const candidate = `F-${String(attempt).padStart(3, "0")}`;
      const exists = await prisma.finding.findUnique({ where: { applicationId_code: { applicationId: app.id, code: candidate } } });
      if (!exists) {
        code = candidate;
        break;
      }
      attempt += 1;
    }
  }

  const row = await prisma.finding.create({
    data: {
      applicationId: app.id,
      code: code!,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      severity: severity.id,
      currentStatus: status.id,
    },
  });

  await recordAudit({
    action: "finding.create",
    entityType: "Finding",
    entityId: row.id,
    newValue: JSON.stringify({ applicationId: app.id, code: row.code, title: row.title, severity: input.severityValue }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return row;
}

export interface SetIterationStateInput {
  findingId: number;
  iterationId: number;
  severityValue: "critical" | "high" | "medium" | "low" | "info";
  statusValue: "open" | "fixed" | "not_fixed" | "not_retested" | "removed" | "out_of_scope" | "not_applicable" | "unknown";
  firstSeenAt?: Date | null;
  retestNote?: string | null;
  comments?: string | null;
}

/**
 * Idempotent per (finding, iteration): re-running with the same status updates
 * notes but the FIRST status transition still appends exactly one history row.
 */
export async function setFindingIterationState(input: SetIterationStateInput, actorUserId: number | null, ctx: { source: "HUMAN" | "EXCEL_IMPORT" | "EML" | "AI" | "SYSTEM"; label?: string; ip?: string; userAgent?: string }) {
  const finding = await prisma.finding.findUnique({ where: { id: input.findingId } });
  if (!finding) throw NotFoundError("Finding");
  const iteration = await prisma.iteration.findUnique({ where: { id: input.iterationId } });
  if (!iteration) throw NotFoundError("Iteration");

  const [severity, statusRow, same] = await Promise.all([
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "severity", value: input.severityValue } } as never }),
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "finding_iteration_status", value: input.statusValue } } as never }),
    prisma.findingIterationState.findUnique({
      where: { findingId_iterationId: { findingId: finding.id, iterationId: iteration.id } },
    }),
  ]);
  if (!severity) throw ValidationError("Unknown severity.");
  if (!statusRow) throw ValidationError("Unknown finding iteration status.");

  const previous = same
    ? await prisma.masterValue.findUnique({ where: { id: same.status } })
    : null;

  const state = same
    ? await prisma.findingIterationState.update({
        where: { id: same.id },
        data: {
          severity: severity.id,
          status: statusRow.id,
          firstSeenAt: input.firstSeenAt ?? same.firstSeenAt,
          retestNote: input.retestNote ?? same.retestNote,
          comments: input.comments ?? same.comments,
        },
      })
    : await prisma.findingIterationState.create({
        data: {
          findingId: finding.id,
          iterationId: iteration.id,
          severity: severity.id,
          status: statusRow.id,
          firstSeenAt: input.firstSeenAt ?? new Date(),
          retestNote: input.retestNote ?? null,
          comments: input.comments ?? null,
        },
      });

  // Append history on every transition (brief section 26).
  if (previous?.value !== statusRow.value) {
    await prisma.findingStatusHistory.create({
      data: {
        findingId: finding.id,
        iterationId: iteration.id,
        oldStatusCode: previous?.value ?? null,
        newStatusCode: statusRow.value,
        note: input.retestNote ?? null,
        actorUserId,
        source: ctx.source,
      } as never,
    });
  }

  // Reflect surface status when the change is the latest iteration.
  const latestIteration = await prisma.iteration.findFirst({
    where: { engagementId: iteration.engagementId },
    orderBy: { number: "desc" },
  });
  if (latestIteration?.id === iteration.id && previous?.value !== statusRow.value) {
    const surface =
      statusRow.value === "fixed"
        ? "fixed"
        : statusRow.value === "not_fixed"
          ? "not_fixed"
          : statusRow.value === "removed"
            ? "removed"
            : statusRow.value === "out_of_scope" || statusRow.value === "not_applicable"
              ? "accepted_risk"
              : "open";
    const target = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "finding_status", value: surface } } });
    if (target && target.id !== finding.currentStatus) {
      await prisma.finding.update({ where: { id: finding.id }, data: { currentStatus: target.id } });
    }
  }

  await recordAudit({
    action: "finding.iteration_state.set",
    entityType: "Finding",
    entityId: finding.id,
    fieldName: `iteration:${iteration.number}`,
    oldValue: previous?.value ?? null,
    newValue: statusRow.value,
    source: ctx.source,
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return state;
}

export async function listFindingHistory(findingId: number) {
  const rows = await prisma.findingStatusHistory.findMany({
    where: { findingId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { iteration: { select: { number: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    findingId: r.findingId,
    iterationNumber: r.iteration?.number ?? null,
    oldStatus: r.oldStatusCode,
    newStatus: r.newStatusCode,
    note: r.note,
    createdAt: r.createdAt,
    source: r.source,
  }));
}

export async function listFindings(applicationId: number) {
  const rows = await prisma.finding.findMany({
    where: { applicationId },
    orderBy: [{ code: "asc" }],
    include: {
      severityRef: true,
      statusRef: true,
      iterationStates: { include: { statusRef: true, severityRef: true, iteration: { select: { number: true } } }, orderBy: { iterationId: "asc" } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description,
    severity: r.severityRef,
    currentStatus: r.statusRef,
    isActive: r.isActive,
    iterationStates: r.iterationStates.map((s) => ({
      id: s.id,
      iterationNumber: s.iteration.number,
      severityValue: s.severityRef.value,
      statusValue: s.statusRef.value,
      statusLabel: s.statusRef.label,
    })),
  }));
}
