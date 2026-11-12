/**
 * Apply an engagement-record field candidate (mail subject, POC, assigned
 * members, dates, comments, follow-ups) after the human approval gate.
 *
 * Semantics (user-directed 2026-11 — "I want all these by AI"):
 * - APPROVE  → fill the field from the AI proposal, but ONLY when the record
 *              currently has no value for it (fill-only; the user's existing
 *              record is never overwritten by approval).
 * - CORRECT  → the human value REPLACES the field (explicit correction wins).
 * - REJECT   → decision recorded, nothing written.
 * Every write is audited (source HUMAN, decisionSource AI semantics).
 */
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

export interface EngagementRecordApplyResult {
  field: string;
  applied: boolean;
  value: string | null;
  reason?: string;
}

const FIELDS = new Set([
  "mailSubject",
  "requestedDate",
  "scanReportDate",
  "iteration1Date",
  "iteration2Date",
  "iteration1Status",
  "iteration2Status",
  "comments",
  "followUpDate",
  "followUpResponse",
  "primaryPoc",
  "assignedMembers",
]);

/** Thread wording → iteration_status vocabulary. */
const ITERATION_STATUS_MAP: Record<string, string> = {
  planned: "planned",
  pending: "pending",
  in_progress: "in_progress",
  "in progress": "in_progress",
  underway: "in_progress",
  completed: "completed",
  complete: "completed",
  done: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

/** Statuses a fresh iteration is auto-provisioned with — approval may replace these. */
const AUTO_PROVISIONED_ITERATION_STATUSES = new Set(["planned", "pending", "in_progress"]);

function parseIterationStatus(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return ITERATION_STATUS_MAP[key] ?? null;
}

/** Tolerant date parsing: DD/MM/YYYY, YYYY-MM-DD, or anything Date() reads. */
function parseDateValue(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "—") return null;
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return new Date(Date.UTC(year, month - 1, day));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t;
}

async function ensureContact(fullName: string, actorUserId: number): Promise<number> {
  const name = fullName.trim();
  const existing = await prisma.contact.findFirst({ where: { fullName: { equals: name, mode: "insensitive" } } });
  if (existing) return existing.id;
  const created = await prisma.contact.create({ data: { fullName: name, org: "Task Manager" } });
  await recordAudit({ action: "contact.ai_record", entityType: "Contact", entityId: created.id, newValue: name, source: "HUMAN", actorUserId });
  return created.id;
}

export async function applyEngagementRecordField(
  params: { extractionId: number; field: string; correctedValue?: string | null },
  actorUserId: number,
): Promise<EngagementRecordApplyResult> {
  if (!FIELDS.has(params.field)) throw ValidationError(`Unknown engagement-record field "${params.field}".`);
  const extraction = await prisma.aiExtraction.findUnique({ where: { id: params.extractionId } });
  if (!extraction) throw NotFoundError("AI extraction");
  const structured = extraction.structuredOutput as { engagementRecord?: Record<string, unknown> | null } | null;
  const proposal = structured?.engagementRecord ?? null;

  // Resolve the candidate value: human correction wins over the AI proposal.
  const corrected = typeof params.correctedValue === "string" && params.correctedValue.trim().length > 0 && params.correctedValue.trim() !== "—"
    ? params.correctedValue.trim()
    : null;
  const aiRaw = proposal ? (proposal[params.field] ?? null) : null;
  const aiValue = typeof aiRaw === "string" && aiRaw.trim().length > 0 && aiRaw.trim() !== "—" ? aiRaw.trim() : null;
  const value = corrected ?? aiValue;

  const thread = extraction.threadId
    ? await prisma.emailThread.findUnique({ where: { id: extraction.threadId }, select: { applicationId: true } })
    : null;
  const applicationId = thread?.applicationId ?? extraction.applicationId;
  if (!applicationId) throw ValidationError("The thread has no application linkage.");
  const app = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!app) throw NotFoundError("Application");
  const engagement = await prisma.engagement.findFirst({
    where: { applicationId }, orderBy: { id: "asc" },
    include: { iterations: { orderBy: { number: "asc" } } },
  });

  const audit = (fieldName: string, oldValue: unknown, newValue: unknown, via: string) =>
    recordAudit({
      action: "engagement_record.applied",
      entityType: "Application",
      entityId: app.id,
      fieldName,
      oldValue: oldValue === null || oldValue === undefined ? null : String(oldValue).slice(0, 500),
      newValue: newValue === null || newValue === undefined ? null : String(newValue).slice(0, 500),
      source: "HUMAN",
      actorUserId,
      index: { field: params.field, via, extractionId: extraction.id },
    });

  // No engagement yet (brand-new app, no iterations): engagement-level fields
  // still apply; iteration-date fields report honestly.
  const isIterationDate = params.field === "iteration1Date" || params.field === "iteration2Date";

  if (!engagement) {
    if (isIterationDate) {
      return { field: params.field, applied: false, value, reason: "no engagement/iterations yet — create the iteration first, then correct" };
    }
    if (params.field === "primaryPoc" && value) {
      if (app.primaryPocId) return { field: params.field, applied: false, value, reason: "POC already set" };
      const contactId = await ensureContact(value, actorUserId);
      await prisma.application.update({ where: { id: app.id }, data: { primaryPocId: contactId } });
      audit("primaryPoc", null, value, corrected ? "correct" : "approve");
      return { field: params.field, applied: true, value };
    }
    if (params.field === "assignedMembers" && value) {
      for (const part of value.split(/[\/,]/).map((s) => s.trim()).filter(Boolean)) {
        const contactId = await ensureContact(part, actorUserId);
        const exists = await prisma.applicationAssignedMember.findFirst({ where: { applicationId: app.id, contactId } });
        if (!exists) await prisma.applicationAssignedMember.create({ data: { applicationId: app.id, contactId } });
      }
      audit("assignedMembers", null, value, corrected ? "correct" : "approve");
      return { field: params.field, applied: true, value };
    }
    return { field: params.field, applied: false, value, reason: "no engagement yet — engagement fields need the engagement container" };
  }

  const engData: Record<string, unknown> = {};
  switch (params.field) {
    case "mailSubject": {
      if (!value) return { field: params.field, applied: false, value: null, reason: "no candidate value" };
      if (!corrected && engagement.mailSubject) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      engData.mailSubject = value;
      break;
    }
    case "requestedDate": {
      const parsed = parseDateValue(value);
      if (!parsed) return { field: params.field, applied: false, value, reason: "unreadable date" };
      if (!corrected && engagement.requestedDate) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      engData.requestedDate = parsed;
      break;
    }
    case "scanReportDate": {
      const parsed = parseDateValue(value);
      if (!parsed) return { field: params.field, applied: false, value, reason: "unreadable date" };
      if (!corrected && engagement.reportDate) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      engData.reportDate = parsed;
      break;
    }
    case "comments": {
      if (!value) return { field: params.field, applied: false, value: null, reason: "no candidate value" };
      if (!corrected && engagement.notes) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      engData.notes = value;
      break;
    }
    case "followUpDate": {
      const parsed = parseDateValue(value);
      if (!parsed) return { field: params.field, applied: false, value, reason: "unreadable date" };
      if (!corrected && engagement.followUpDate) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      engData.followUpDate = parsed;
      break;
    }
    case "followUpResponse": {
      if (!value) return { field: params.field, applied: false, value: null, reason: "no candidate value" };
      if (!corrected && engagement.followUpResponse) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      engData.followUpResponse = value;
      break;
    }
    case "iteration1Date": {
      const i1 = engagement.iterations.find((it) => it.number === 1);
      if (!i1) return { field: params.field, applied: false, value, reason: "no Iteration 1 yet" };
      const parsed = parseDateValue(value);
      if (!parsed) return { field: params.field, applied: false, value, reason: "unreadable date" };
      if (!corrected && i1.reportDate) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      await prisma.iteration.update({ where: { id: i1.id }, data: { reportDate: parsed, startDate: i1.startDate ?? parsed } });
      audit("iteration1Date", i1.reportDate, parsed, corrected ? "correct" : "approve");
      return { field: params.field, applied: true, value: parsed.toISOString() };
    }
    case "iteration2Date": {
      const i2 = engagement.iterations.find((it) => it.number === 2);
      if (!i2) return { field: params.field, applied: false, value, reason: "no Iteration 2 yet" };
      const parsed = parseDateValue(value);
      if (!parsed) return { field: params.field, applied: false, value, reason: "unreadable date" };
      if (!corrected && i2.reportDate) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      await prisma.iteration.update({ where: { id: i2.id }, data: { reportDate: parsed } });
      audit("iteration2Date", i2.reportDate, parsed, corrected ? "correct" : "approve");
      return { field: params.field, applied: true, value: parsed.toISOString() };
    }
    case "iteration1Status":
    case "iteration2Status": {
      const number = params.field === "iteration1Status" ? 1 : 2;
      const iteration = engagement.iterations.find((it) => it.number === number);
      if (!iteration) return { field: params.field, applied: false, value, reason: `no Iteration ${number} yet` };
      const statusValue = parseIterationStatus(value);
      if (!statusValue) return { field: params.field, applied: false, value, reason: `unrecognized iteration status "${value ?? ""}" (planned|in_progress|pending|completed|cancelled)` };
      const current = await prisma.iteration.findUnique({ where: { id: iteration.id }, include: { statusRef: { select: { value: true } } } });
      const currentValue = current?.statusRef.value ?? null;
      // APPROVE fills only an auto-provisioned default status (planned/pending/
      // in_progress) — a deliberate human status (e.g. Completed) is never
      // overwritten by approval. CORRECT always wins (explicit human value).
      if (!corrected && currentValue && !AUTO_PROVISIONED_ITERATION_STATUSES.has(currentValue)) {
        return { field: params.field, applied: false, value, reason: `iteration ${number} status already deliberately set (${currentValue})` };
      }
      if (!corrected && currentValue === statusValue) {
        return { field: params.field, applied: false, value, reason: "already in that status" };
      }
      const statusRow = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "iteration_status", value: statusValue } } });
      if (!statusRow) return { field: params.field, applied: false, value, reason: "unknown iteration status vocabulary" };
      await prisma.iteration.update({ where: { id: iteration.id }, data: { status: statusRow.id } });
      audit(params.field, currentValue, statusValue, corrected ? "correct" : "approve");
      return { field: params.field, applied: true, value: statusValue };
    }
    case "primaryPoc": {
      if (!value) return { field: params.field, applied: false, value: null, reason: "no candidate value" };
      if (!corrected && app.primaryPocId) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      const contactId = await ensureContact(value, actorUserId);
      await prisma.application.update({ where: { id: app.id }, data: { primaryPocId: contactId } });
      audit("primaryPoc", app.primaryPocId, value, corrected ? "correct" : "approve");
      return { field: params.field, applied: true, value };
    }
    case "assignedMembers": {
      if (!value) return { field: params.field, applied: false, value: null, reason: "no candidate value" };
      const existingMembers = await prisma.applicationAssignedMember.findMany({ where: { applicationId: app.id } });
      if (!corrected && existingMembers.length > 0) return { field: params.field, applied: false, value, reason: "already set (fill-only)" };
      if (corrected) {
        // Explicit correction replaces the assigned-member set.
        await prisma.applicationAssignedMember.deleteMany({ where: { applicationId: app.id } });
      }
      for (const part of value.split(/[\/,]/).map((s) => s.trim()).filter(Boolean)) {
        const contactId = await ensureContact(part, actorUserId);
        const exists = await prisma.applicationAssignedMember.findFirst({ where: { applicationId: app.id, contactId } });
        if (!exists) await prisma.applicationAssignedMember.create({ data: { applicationId: app.id, contactId } });
      }
      audit("assignedMembers", existingMembers.length, value, corrected ? "correct" : "approve");
      return { field: params.field, applied: true, value };
    }
    default:
      throw ValidationError(`Unhandled field "${params.field}".`);
  }

  if (Object.keys(engData).length > 0) {
    await prisma.engagement.update({ where: { id: engagement.id }, data: engData });
    audit(params.field, null, value, corrected ? "correct" : "approve");
    return { field: params.field, applied: true, value };
  }
  return { field: params.field, applied: false, value, reason: "nothing to write" };
}
