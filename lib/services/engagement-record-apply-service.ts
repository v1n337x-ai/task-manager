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

/** Single source of truth for the record fields a human can approve/correct. */
export const ENGAGEMENT_RECORD_FIELDS = [
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
] as const;

export type EngagementRecordField = (typeof ENGAGEMENT_RECORD_FIELDS)[number];

const FIELDS = new Set<string>(ENGAGEMENT_RECORD_FIELDS);

/** Participant roles that are never the client-side application owner / POC. */
const NON_OWNER_PARTICIPANT_ROLES = new Set([
  "pentester",
  "developer",
  "security_team",
  "management",
  "other",
  "unknown",
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

type PocParticipant = { aliases: string[]; role: string | null; preferredName: string | null };

function normalizePerson(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._\-+]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function aliasSet(...values: Array<string | null | undefined>): string[] {
  const aliases = new Set<string>();
  for (const value of values) {
    const normal = normalizePerson(value ?? "");
    if (normal) aliases.add(normal);
  }
  return [...aliases];
}

function matchesPerson(name: string, participant: PocParticipant): boolean {
  const target = normalizePerson(name);
  if (!target) return false;
  return participant.aliases.some((alias) =>
    alias === target || (alias.length > 3 && target.includes(alias)) || (target.length > 3 && alias.includes(target)),
  );
}

/**
 * Client-agnostic POC rule: the POC is the application owner, never a person
 * whose mailbox participant role is pentester / developer / security team /
 * management / other. On APPROVE the application_owner participant is used
 * automatically; a human CORRECTION always wins (the reviewer decides).
 */
async function resolvePocValue(
  raw: string | null,
  corrected: string | null,
  structured: { participants?: Array<{ email?: string; name?: string | null; proposedRole?: string }> } | null,
  threadId: number | null,
): Promise<string | null> {
  const mailbox = threadId
    ? await prisma.emailParticipant.findMany({
        where: {
          OR: [
            { messagesFrom: { some: { threadId } } },
            { recipients: { some: { message: { threadId } } } },
          ],
        },
        select: {
          emailAddress: true, displayName: true, name: true,
          roleRef: { select: { value: true } },
          roleOverrideRef: { select: { value: true } },
        },
      })
    : [];

  const people: PocParticipant[] = mailbox.map((p) => ({
    aliases: aliasSet(p.displayName, p.name, nameFromEmail(p.emailAddress), p.emailAddress.split("@")[0]),
    role: p.roleOverrideRef?.value ?? p.roleRef.value ?? null,
    preferredName: p.displayName?.trim() || p.name?.trim() || nameFromEmail(p.emailAddress) || null,
  }));

  // Include AI proposals not yet present as mailbox participants.
  for (const proposal of structured?.participants ?? []) {
    const email = proposal.email?.toLowerCase().trim();
    if (!email) continue;
    const proposalAliases = aliasSet(proposal.name, nameFromEmail(email), email.split("@")[0]);
    if (people.some((p) => p.aliases.some((a) => proposalAliases.some((x) => x.includes(a) || a.includes(x))))) continue;
    people.push({
      aliases: proposalAliases,
      role: proposal.proposedRole?.toLowerCase() ?? null,
      preferredName: proposal.name?.trim() || nameFromEmail(email) || null,
    });
  }

  const isNonOwner = (name: string): boolean => {
    const match = people.find((p) => matchesPerson(name, p));
    return !!match?.role && NON_OWNER_PARTICIPANT_ROLES.has(match.role);
  };

  // A human correction is authoritative — the reviewer, not the role heuristic,
  // decides who the application owner is.
  if (corrected) return corrected;
  const owner = people.find((p) => p.role === "application_owner" && p.preferredName);
  if (owner?.preferredName) return owner.preferredName;
  return raw && !isNonOwner(raw) ? raw : null;
}

export async function applyEngagementRecordField(
  params: { extractionId: number; field: string; correctedValue?: string | null },
  actorUserId: number,
): Promise<EngagementRecordApplyResult> {
  if (!FIELDS.has(params.field)) throw ValidationError(`Unknown engagement-record field "${params.field}".`);
  const extraction = await prisma.aiExtraction.findUnique({ where: { id: params.extractionId } });
  if (!extraction) throw NotFoundError("AI extraction");
  const structured = extraction.structuredOutput as {
    engagementRecord?: Record<string, unknown> | null;
    participants?: Array<{ email?: string; name?: string | null; proposedRole?: string }>;
  } | null;
  const proposal = structured?.engagementRecord ?? null;

  // Resolve the candidate value: human correction wins over the AI proposal.
  const corrected = typeof params.correctedValue === "string" && params.correctedValue.trim().length > 0 && params.correctedValue.trim() !== "—"
    ? params.correctedValue.trim()
    : null;
  const aiRaw = proposal ? (proposal[params.field] ?? null) : null;
  const aiValue = typeof aiRaw === "string" && aiRaw.trim().length > 0 && aiRaw.trim() !== "—" ? aiRaw.trim() : null;
  const value = params.field === "primaryPoc"
    ? await resolvePocValue(aiValue, corrected, structured, extraction.threadId ?? null)
    : corrected ?? aiValue;
  if (params.field === "primaryPoc" && corrected && !value) {
    return { field: params.field, applied: false, value: null, reason: "POC must be the application owner; vendor/analyst names are not valid POCs." };
  }

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
