/**
 * Email foundations (brief sections 27-31).
 * Phase 2 stores thread/message/participant/attachment metadata only — actual
 * EML parsing lands in Phase 6. The thread model supports reconstruction via
 * Message-ID / In-Reply-To / References / Subject keys.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

/** Deterministic thread key: normalize → strip reply markers/ticket tags → sha256. */
export function normalizeSubjectForThread(subject: string): string {
  return subject
    .toLowerCase()
    // drop reply/forward markers anywhere after a prefix
    .replace(/(^|[\s:>-]+)(re|fwd?|aw)(\s*:\s*)+/gi, " ")
    // strip bracketed ticket/request tags like "[Request ID :##SR-12732##]" and "##SR-12732##"
    .replace(/\[[^\]]*(request id|ticket|sr-\d+)[^\]]*\]/gi, " ")
    .replace(/##sr-\d+##?/gi, " ")
    .replace(/[^a-z0-9@.\-'&/_ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s:>-]+/, "");
}

export function subjectHash(subject: string): string {
  return createHash("sha256").update(normalizeSubjectForThread(subject)).digest("hex");
}

export async function upsertParticipant(
  input: {
    emailAddress: string;
    name: string;
    roleValue: string;
    roleSource: "UNKNOWN" | "RULE" | "AI" | "HUMAN";
    confidence?: number | null;
  },
  _actorUserId: number | null,
) {
  const email = input.emailAddress.toLowerCase().trim();
  const role = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "participant_role", value: input.roleValue } },
  });
  if (!role) throw ValidationError("Unknown participant role.");

  const existing = await prisma.emailParticipant.findUnique({ where: { emailAddress: email } });
  if (existing) {
    return prisma.emailParticipant.update({
      where: { id: existing.id },
      data: {
        name: input.name || existing.name,
        displayName: input.name || existing.displayName,
        roleSource: input.roleSource === "UNKNOWN" ? existing.roleSource : input.roleSource,
        role: input.roleSource === "HUMAN" ? role.id : existing.role,
        confidence: input.confidence ?? existing.confidence,
      },
    });
  }
  return prisma.emailParticipant.create({
    data: {
      emailAddress: email,
      name: input.name,
      displayName: input.name,
      role: role.id,
      roleSource: input.roleSource,
      confidence: input.confidence ?? null,
    },
  });
}

/** Human role override (§30): effective role must prefer the human. */
export async function overrideParticipantRole(input: { participantEmail: string; roleValue: string; note?: string; overrideByUserId?: number }, actorUserId: number) {
  const participant = await prisma.emailParticipant.findUnique({ where: { emailAddress: input.participantEmail.toLowerCase().trim() } });
  if (!participant) throw NotFoundError("Email participant");
  const role = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "participant_role", value: input.roleValue } } });
  if (!role) throw ValidationError("Unknown participant role.");

  await prisma.emailParticipant.update({
    where: { id: participant.id },
    data: {
      humanOverrideRole: role.id,
      overrideNote: input.note ?? null,
      overrideByUserId: input.overrideByUserId ?? actorUserId,
      roleSource: "HUMAN",
    },
  });

  await recordAudit({
    action: "email_participant.role_override",
    entityType: "EmailParticipant",
    entityId: participant.id,
    fieldName: "role",
    oldValue: null,
    newValue: role.value,
    source: "HUMAN",
    actorUserId,
  });
}

export async function createThread(input: { applicationId?: number | null; subject: string; participantKey?: string }, _actorUserId: number | null) {
  const normalized = normalizeSubjectForThread(input.subject);
  if (!normalized) throw ValidationError("Thread subject is required after normalization.");
  const hash = subjectHash(input.subject);

  const dup = await prisma.emailThread.findFirst({ where: { subjectHash: hash, applicationId: input.applicationId ?? null } });
  if (dup) return dup; // idempotent thread creation for repeated subject matches

  const thread = await prisma.emailThread.create({
    data: {
      applicationId: input.applicationId ?? null,
      subject: normalized,
      subjectHash: hash,
      participantKey: input.participantKey ?? "",
    },
  });
  await recordAudit({
    action: "email_thread.create",
    entityType: "EmailThread",
    entityId: thread.id,
    newValue: JSON.stringify({ subject: normalized }),
    source: "SYSTEM",
    actorUserId: _actorUserId,
  });
  return thread;
}

export interface CreateEmailMessageInput {
  threadId: number;
  messageId: string; // required — RFC Message-ID as the stable identity
  fromParticipantId: number;
  subject?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  sentAt?: Date | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  sourceFile?: string | null;
  recipients?: { kind: "TO" | "CC" | "BCC"; email: string; name?: string; participantId?: number }[];
}

export async function createMessage(input: CreateEmailMessageInput, actorUserId: number | null) {
  const thread = await prisma.emailThread.findUnique({ where: { id: input.threadId } });
  if (!thread) throw NotFoundError("Email thread");

  const dup = await prisma.emailMessage.findUnique({ where: { messageId: input.messageId } });
  if (dup) throw ConflictError(`Email message ${input.messageId} already exists (idempotent thread reconstruction).`);

  const message = await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      messageId: input.messageId,
      inReplyTo: input.inReplyTo ?? null,
      references: input.references ?? null,
      fromParticipantId: input.fromParticipantId,
      subject: input.subject ?? null,
      sentAt: input.sentAt ?? null,
      bodyText: input.bodyText ?? null,
      bodyHtml: input.bodyHtml ?? null,
      sourceFile: input.sourceFile ?? null,
      recipients: {
        create: (input.recipients ?? []).map((r) => ({
          kind: r.kind,
          email: r.email.toLowerCase(),
          name: r.name ?? null,
          participantId: r.participantId ?? null,
        })),
      },
    },
    include: { recipients: true },
  });

  await recordAudit({
    action: "email_message.create",
    entityType: "EmailMessage",
    entityId: message.id,
    newValue: JSON.stringify({ threadId: thread.id, messageId: input.messageId }),
    source: "SYSTEM",
    actorUserId,
  });

  return message;
}

export interface CreateAttachmentMetaInput {
  messageId: number;
  filename: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  storageReference?: string | null;
  sha256?: string | null;
}

export async function createAttachmentMeta(input: CreateAttachmentMetaInput, actorUserId: number | null) {
  const message = await prisma.emailMessage.findUnique({ where: { id: input.messageId } });
  if (!message) throw NotFoundError("Email message");

  const statusRow = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "attachment_status", value: "pending" } },
  });
  if (!statusRow) throw NotFoundError("attachment_status master value");

  const row = await prisma.emailAttachment.create({
    data: {
      messageId: message.id,
      filename: input.filename, // display-only; never trusted as a security control (§31/48)
      contentType: input.contentType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      storageReference: input.storageReference ?? null,
      sha256: input.sha256 ?? null,
      processingStatus: statusRow.id,
    },
  });
  await recordAudit({
    action: "email_attachment.create",
    entityType: "EmailAttachment",
    entityId: row.id,
    newValue: JSON.stringify({ messageId: message.id, filename: input.filename }),
    source: "SYSTEM",
    actorUserId,
  });
  return row;
}

/** Email foundations (brief sections 27-31). Phase 2 stores thread/message/participant/attachment metadata only — actual EML parsing lands in Phase 6. */
export async function listThreads(applicationId?: number) {
  return prisma.emailThread.findMany({
    where: applicationId ? { applicationId } : undefined,
    include: { messages: { orderBy: { sentAt: "asc" }, include: { fromContact: true } } },
    orderBy: { updatedAt: "desc" },
  });
}
