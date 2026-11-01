/**
 * Engagement / Iteration services (brief sections 18-19).
 * Iterations are an entity with an open-ended `number` — Iteration 3, 4, … work
 * without a schema redesign.
 */
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

export interface EngagementInput {
  applicationId: number;
  name: string;
  scopeValue: string;
  assessmentSourceValue: string;
  target?: string | null;
  mailSubject?: string | null;
  statusValue?: string;
  requestedDate?: Date | null;
  reportDate?: Date | null;
  notes?: string | null;
}

export interface IterationInput {
  engagementId: number;
  iterationTypeValue: "initial_scan" | "retest" | "follow_up" | "other";
  name?: string;
  startDate?: Date | null;
  reportDate?: Date | null;
  statusValue?: string;
}

const DEFAULT_APPLICATION_TARGET_TYPES = new Set(["initial_scan"]);
/** Rule (brief 18/19): iteration 1 must be an Initial Scan. */
function iterationTypeQuirk(iteration: number, typeValue: string): void {
  if (iteration === 1 && typeValue !== "initial_scan" && !DEFAULT_APPLICATION_TARGET_TYPES.has(typeValue)) {
    throw ValidationError('Iteration 1 must use type "Initial Scan".');
  }
  if (iteration > 1 && typeValue === "initial_scan") {
    throw ValidationError('Iterations 2+ cannot be "Initial Scan" — use Retest or Follow-up.');
  }
}

export async function createEngagement(input: EngagementInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }) {
  const app = await prisma.application.findUnique({ where: { id: input.applicationId } });
  if (!app) throw NotFoundError("Application");

  const [scope, source, status] = await Promise.all([
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "scope", value: input.scopeValue } } }),
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "assessment_source", value: input.assessmentSourceValue } } }),
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "engagement_status", value: input.statusValue ?? "initiated" } } }),
  ]);
  if (!scope || !source || !status) throw ValidationError("Unknown scope, assessment source or engagement status.");

  const dup = await prisma.engagement.findUnique({
    where: { applicationId_name: { applicationId: app.id, name: input.name.trim() } },
  });
  if (dup) throw ConflictError(`Engagement "${input.name}" already exists for this application.`);

  const row = await prisma.engagement.create({
    data: {
      applicationId: app.id,
      name: input.name.trim(),
      scope: scope.id,
      assessmentSource: source.id,
      target: input.target?.trim() || null,
      mailSubject: input.mailSubject?.trim() || null,
      status: status.id,
      requestedDate: input.requestedDate ?? null,
      reportDate: input.reportDate ?? null,
      notes: input.notes ?? null,
    },
  });

  await recordAudit({
    action: "engagement.create",
    entityType: "Engagement",
    entityId: row.id,
    newValue: JSON.stringify({ applicationId: app.id, name: row.name }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return row;
}

export async function createIteration(input: IterationInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }) {
  const engagement = await prisma.engagement.findUnique({
    where: { id: input.engagementId },
    include: { iterations: { orderBy: { number: "desc" }, take: 1 } },
  });
  if (!engagement) throw NotFoundError("Engagement");

  const [typeRow, statusRow] = await Promise.all([
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "iteration_type", value: input.iterationTypeValue } } }),
    prisma.masterValue.findUnique({ where: { domain_value: { domain: "iteration_status", value: input.statusValue ?? "planned" } } }),
  ]);
  if (!typeRow) throw ValidationError("Unknown iteration type.");
  if (!statusRow) throw ValidationError("Unknown iteration status.");

  const lastNumber = engagement.iterations[0]?.number ?? 0;
  const number = lastNumber + 1;
  iterationTypeQuirk(number, input.iterationTypeValue);

  const name = input.name?.trim() || (input.iterationTypeValue === "initial_scan" ? `Iteration ${number} — Initial Scan` : `Iteration ${number}`);
  const row = await prisma.iteration.create({
    data: {
      engagementId: engagement.id,
      number,
      iterationType: typeRow.id,
      name,
      startDate: input.startDate ?? null,
      reportDate: input.reportDate ?? null,
      status: statusRow.id,
    },
  });

  await recordAudit({
    action: "iteration.create",
    entityType: "Iteration",
    entityId: row.id,
    newValue: JSON.stringify({ engagementId: engagement.id, number, type: input.iterationTypeValue }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return row;
}

export interface UpdateIterationInput {
  name?: string;
  iterationTypeValue?: string;
  statusValue?: string;
  startDate?: Date | null;
  reportDate?: Date | null;
  notes?: string | null;
}

export async function updateIteration(iterationId: number, patch: UpdateIterationInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }) {
  const before = await prisma.iteration.findUnique({ where: { id: iterationId } });
  if (!before) throw NotFoundError("Iteration");

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.startDate !== undefined) data.startDate = patch.startDate;
  if (patch.reportDate !== undefined) data.reportDate = patch.reportDate;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.iterationTypeValue) {
    const v = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "iteration_type", value: patch.iterationTypeValue } } });
    if (!v) throw ValidationError("Unknown iteration type.");
    data.iterationType = v.id;
    iterationTypeQuirk(before.number, patch.iterationTypeValue);
  }
  if (patch.statusValue) {
    const v = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "iteration_status", value: patch.statusValue } } });
    if (!v) throw ValidationError("Unknown iteration status.");
    data.status = v.id;
  }

  const row = await prisma.iteration.update({ where: { id: iterationId }, data });
  await recordAudit({
    action: "iteration.update",
    entityType: "Iteration",
    entityId: iterationId,
    newValue: JSON.stringify({ number: row.number, changed: Object.keys(data) }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return row;
}

export async function listIterations(engagementId: number) {
  return prisma.iteration.findMany({
    where: { engagementId },
    orderBy: [{ number: "asc" }],
    include: { iterationTypeRef: true, statusRef: true },
  });
}
