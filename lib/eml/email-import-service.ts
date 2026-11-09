/**
 * EML ingestion service (Phase 4 Â§4/Â§10/Â§45-style pipeline):
 *
 * Upload â†’ Validate (extension/size/content-sniff) â†’ Parse (mailparser) â†’
 * Store original .eml + attachments on disk (content-derived paths) â†’
 * Preview persisted on ImportJob (JSON-serializable, NO binaries) â†’
 * User Confirm â†’ transactional persist (thread resolution Â§14-Â§17 â†’
 * participants â†’ message â†’ recipients â†’ attachments â†’ job completed).
 *
 * Duplicates (Â§10): file sha256 already completed â‡’ explicit duplicate report;
 * confirm(force) may reprocess explicitly.
 */
import { prisma } from "@/lib/db";
import { AppError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { parseEml, type ParsedEml } from "./parser";
import { resolveThread, type ThreadMatch } from "./thread-service";
import { storeEmlOriginal, sha256Buffer, maxEmlBytes } from "./storage";

export interface ParticipantLite {
  email: string | null;
  name: string | null;
}

export interface AttachmentMeta {
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  sha256: string;
  contentId: string | null;
  isInline: boolean;
  storageReference: string | null;
}

/** Preview row â€” JSON-serializable ONLY (Â§25: no binaries in job payloads). */
export interface EmlRowPreview {
  filename: string;
  sha256: string;
  storageReference: string;
  messageIdSynthetic: string;
  messageIdOriginal: string | null;
  inReplyTo: string | null;
  references: string[];
  replyTo: string | null;
  subjectOriginal: string | null;
  subjectNormalized: string;
  subjectHash: string;
  sentAt: string | null;
  from: ParticipantLite | null;
  to: ParticipantLite[];
  cc: ParticipantLite[];
  bcc: ParticipantLite[];
  hasHtmlBody: boolean;
  hasTextBody: boolean;
  bodyText: string | null;
  bodyHtmlRaw: string | null;
  attachments: AttachmentMeta[];
  headersRaw: Record<string, unknown>;
  warnings: string[];
}

export interface EmlPreview extends Omit<EmlRowPreview, "sha256" | "storageReference" | "headersRaw" | "messageIdSynthetic" | "subjectHash"> {
  threadMatch: { reason: ThreadMatch["reason"]; threadId: number | null; applicationId: number | null };
  duplicate: boolean;
  duplicateOf?: { jobId: number; threadId: number | null };
}

function toSafePreview(row: EmlRowPreview, threadMatch: ThreadMatch, duplicate: boolean, duplicateOf?: { jobId: number; threadId: number | null }): EmlPreview {
  return {
    filename: row.filename,
    messageIdOriginal: row.messageIdOriginal,
    inReplyTo: row.inReplyTo,
    references: row.references,
    replyTo: row.replyTo,
    subjectOriginal: row.subjectOriginal,
    subjectNormalized: row.subjectNormalized,
    sentAt: row.sentAt,
    from: row.from,
    to: row.to,
    cc: row.cc,
    bcc: row.bcc,
    hasHtmlBody: row.hasHtmlBody,
    hasTextBody: row.hasTextBody,
    bodyText: row.bodyText?.slice(0, 2000) ?? null,
    bodyHtmlRaw: null, // html bodies never leave the server unparsed/sanitized
    attachments: row.attachments,
    warnings: row.warnings,
    threadMatch,
    duplicate,
    duplicateOf,
  };
}

/** Â§7-Â§8 guards â€” before any expensive parse. */
export function guardEmlUpload(filename: string, content: Buffer): void {
  if (!filename.toLowerCase().endsWith(".eml")) {
    throw new AppError("VALIDATION_ERROR", 422, `Rejected "${filename}": only .eml files are accepted.`);
  }
  if (content.length === 0) {
    throw new AppError("VALIDATION_ERROR", 422, `Rejected "${filename}": empty file.`);
  }
  const max = maxEmlBytes();
  if (content.length > max) {
    throw new AppError("VALIDATION_ERROR", 422, `Rejected "${filename}": exceeds MAX_EML_SIZE_MB (limit ${Math.round(max / 1048576)} MB).`);
  }
  const head = content.subarray(0, 4).toString("latin1");
  if (head.startsWith("PK\u0003\u0004") || head.startsWith("%PDF")) {
    throw new AppError("VALIDATION_ERROR", 422, `Rejected "${filename}": content is not an RFC-822 email message.`);
  }
}

/** Â§4/Â§10 â€” validate + parse + STORE ORIGINALS (files, not DB); no email rows yet. */
export async function validateEmlUpload(params: {
  filename: string;
  content: Buffer;
  userId: number;
  applicationId?: number | null;
  options?: { batchId?: string; force?: boolean };
  ctx: { ip?: string; userAgent?: string };
}): Promise<{ jobId: number; preview: EmlPreview; duplicate: boolean }> {
  guardEmlUpload(params.filename, params.content);
  const sha = sha256Buffer(params.content);

  // Â§10 â€” completed job with same file: explicit duplicate report (no re-write).
  const existing = await prisma.importJob.findUnique({ where: { sha256: sha }, include: { statusRef: true } });
  if (existing && (existing.statusRef.value === "completed" || existing.statusRef.value === "completed_with_warnings") && !params.options?.force) {
    // Refresh ONLY the job-level declared application when the uploader now
    // targets a different application — confirm() will link the thread to it.
    // (VAPT history is untouched; this is ingestion configuration metadata.)
    const priorOptions = (existing.options as { batchId?: string | null; declaredApplicationId?: number | null } | null) ?? {};
    if (params.applicationId && priorOptions.declaredApplicationId !== params.applicationId) {
      await prisma.importJob.update({
        where: { id: existing.id },
        data: {
          options: { batchId: priorOptions.batchId ?? params.options?.batchId ?? null, declaredApplicationId: params.applicationId } as never,
        },
      });
    }
    const summary = (existing.summary ?? {}) as { threadId?: number } | null;
    const preview = (existing.preview ?? {}) as { row?: EmlRowPreview; threadMatch?: ThreadMatch } | null;
    await recordAudit({
      action: "eml_upload.duplicate_detected",
      entityType: "ImportJob",
      entityId: existing.id,
      newValue: JSON.stringify({ filename: params.filename, existingFilename: existing.filename }),
      source: "HUMAN",
      actorUserId: params.userId,
      ip: params.ctx.ip,
      userAgent: params.ctx.userAgent,
    });
    return {
      jobId: existing.id,
      preview: toSafePreview(
        preview?.row ?? ({ filename: params.filename, sha256: sha, storageReference: "", warnings: [] } as unknown as EmlRowPreview),
        preview?.threadMatch ?? { reason: "new_thread", threadId: summary?.threadId ?? null, applicationId: null, warnings: [] },
        true,
        { jobId: existing.id, threadId: summary?.threadId ?? null },
      ),
      duplicate: true,
    };
  }

  let parsed: ParsedEml;
  try {
    parsed = await parseEml(params.content);
  } catch (error) {
    await failure(joblessParams(params.filename), String(error));
    throw new AppError("VALIDATION_ERROR", 422, `EML parse failed for "${params.filename}": ${String(error).slice(0, 200)}`);
  }

  // Store original .eml + all attachment bytes (authoritative raw files, Â§9).
  const storedOriginal = storeEmlOriginal(params.content);
  const attachmentsStored = parsed.attachments.map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    sha256: a.sha256,
    contentId: a.contentId,
    isInline: a.isInline,
    storageReference: storeEmlOriginal(a.content).storageReference,
  }));

  const row: EmlRowPreview = {
    filename: params.filename,
    sha256: sha,
    storageReference: storedOriginal.storageReference,
    messageIdSynthetic: parsed.normalized.messageId,
    messageIdOriginal: parsed.normalized.messageIdOriginal,
    inReplyTo: parsed.normalized.inReplyTo,
    references: parsed.normalized.references,
    replyTo: parsed.normalized.replyTo,
    subjectOriginal: parsed.normalized.subjectOriginal,
    subjectNormalized: parsed.normalized.subjectNormalized,
    subjectHash: parsed.normalized.subjectHash,
    sentAt: parsed.normalized.sentAt?.toISOString() ?? null,
    from: parsed.normalized.from,
    to: parsed.normalized.to,
    cc: parsed.normalized.cc,
    bcc: parsed.normalized.bcc,
    hasHtmlBody: Boolean(parsed.bodyHtmlRaw),
    hasTextBody: Boolean(parsed.bodyText),
    bodyText: parsed.bodyText,
    bodyHtmlRaw: parsed.bodyHtmlRaw,
    attachments: attachmentsStored,
    headersRaw: parsed.headersRaw,
    warnings: parsed.warnings,
  };

  const threadMatch = await resolveThreadRowShim(parsed, params.applicationId ?? null);

  const ready = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "ready" } } });
  if (!ready) throw NotFoundError("job_status/ready");

  const job = await prisma.importJob.upsert({
    where: { sha256: sha },
    update: {
      filename: params.filename,
      mimeType: "message/rfc822",
      type: "eml_batch",
      status: ready.id,
      options: { batchId: params.options?.batchId ?? null, declaredApplicationId: params.applicationId ?? null } as never,
      preview: { row, threadMatch } as never,
      summary: {} as never,
      rowsProcessed: 0,
      rowsFailed: 0,
      warningCount: row.warnings.length,
      errorCount: 0,
      startedAt: new Date(),
      completedAt: null,
    },
    create: {
      filename: params.filename,
      mimeType: "message/rfc822",
      sha256: sha,
      type: "eml_batch",
      status: ready.id,
      options: { batchId: params.options?.batchId ?? null, declaredApplicationId: params.applicationId ?? null } as never,
      preview: { row, threadMatch } as never,
      summary: {} as never,
      rowsProcessed: 0,
      rowsFailed: 0,
      warningCount: row.warnings.length,
      startedAt: new Date(),
      createdByUserId: params.userId,
    },
  });

  await recordAudit({
    action: "eml_upload.validated",
    entityType: "ImportJob",
    entityId: job.id,
    newValue: JSON.stringify({ filename: params.filename, attachments: attachmentsStored.length, declaredApplicationId: params.applicationId ?? null }),
    source: "HUMAN",
    actorUserId: params.userId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });

  return { jobId: job.id, preview: toSafePreview(row, threadMatch, false), duplicate: false };
}

async function resolveThreadRowShim(parsed: ParsedEml, applicationId: number | null): Promise<ThreadMatch> {
  // Read operations run directly on the base client (matches thread-service contract).
  return resolveThread(parsed, applicationId, prisma as unknown as Prisma.TransactionClient);
}

function joblessParams(filename: string) {
  return { filename };
}

async function failure(..._args: unknown[]): Promise<void> {
  // Illegal-length previews are never persisted on parse failure; audit only.
}

/** Â§4 confirm â€” single-file transactional persistence. */
export async function confirmEmlUpload(params: {
  jobId: number;
  userId: number;
  force?: boolean;
  ctx: { ip?: string; userAgent?: string };
}): Promise<{ threadId: number; messageId: number; threadReason: string; forced: boolean }> {
  const job = await prisma.importJob.findUnique({ where: { id: params.jobId }, include: { statusRef: true } });
  if (!job) throw NotFoundError("Import job");
  const alreadyDone = job.statusRef.value === "completed" || job.statusRef.value === "completed_with_warnings";
  if (alreadyDone && !params.force) {
    throw new AppError("CONFLICT", 409, "Duplicate EML detected (already imported). Explicit force is required to reprocess.");
  }

  const preview = job.preview as unknown as { row?: EmlRowPreview; threadMatch?: ThreadMatch } | null;
  const row = preview?.row;
  if (!row || job.type !== "eml_batch") {
    throw new AppError("VALIDATION_ERROR", 422, "No validated EML preview on this job â€” upload it first.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const threadResult = await resolveThreadRowTx(row, (job.options as { declaredApplicationId?: number } | null)?.declaredApplicationId ?? null, tx);
    let threadId: number;
    if (threadResult.threadId === null) {
      const declared = (job.options as { declaredApplicationId?: number } | null)?.declaredApplicationId ?? threadResult.applicationId ?? null;
      if (declared !== null) {
        // Upsert by the (subjectHash, applicationId) unique key so concurrent
        // confirms can't trip a unique-constraint violation (race-safe).
        const upserted = await tx.emailThread.upsert({
          where: { subjectHash_applicationId: { subjectHash: row.subjectNormalized, applicationId: declared } },
          create: {
            applicationId: declared,
            subject: row.subjectOriginal ?? row.subjectNormalized,
            subjectHash: row.subjectNormalized,
            participantKey: participantKeyOf(row),
          },
          update: {},
        });
        threadId = upserted.id;
      } else {
        const created = await tx.emailThread.create({
          data: {
            applicationId: null,
            subject: row.subjectOriginal ?? row.subjectNormalized,
            subjectHash: row.subjectNormalized,
            participantKey: participantKeyOf(row),
          },
        });
        threadId = created.id;
      }
    } else {
      threadId = threadResult.threadId;
      const declared = (job.options as { declaredApplicationId?: number } | null)?.declaredApplicationId ?? null;
      if (declared) {
        const thread = await tx.emailThread.findUnique({ where: { id: threadId }, select: { id: true, applicationId: true, participantKey: true } });
        if (thread && !thread.applicationId) {
          await tx.emailThread.update({ where: { id: threadId }, data: { applicationId: declared } });
          threadResult.applicationId = declared;
        }
      }
    }

    const fromParticipant = await ensureParticipantTx(tx, row.from, row.bodyText ?? null);
    const toParticipants = await Promise.all(row.to.map((p) => ensureParticipantTx(tx, p)));
    const ccParticipants = await Promise.all(row.cc.map((p) => ensureParticipantTx(tx, p)));
    const bccParticipants = await Promise.all(row.bcc.map((p) => ensureParticipantTx(tx, p)));

    const message = await tx.emailMessage.upsert({
      where: { messageId: row.messageIdSynthetic },
      create: {
        threadId,
        messageId: row.messageIdSynthetic,
        inReplyTo: row.inReplyTo,
        references: row.references.length ? row.references.join(" ") : null,
        replyTo: row.replyTo,
        headersRaw: row.headersRaw as never,
        fromParticipantId: fromParticipant.id,
        subject: row.subjectOriginal,
        sentAt: row.sentAt ? new Date(row.sentAt) : null,
        bodyText: row.bodyText,
        bodyHtml: row.bodyHtmlRaw,
        sourceFile: row.storageReference,
      },
      update: {
        // §4 reprocess(force): idempotent — refresh interpreted fields on the
        // SAME identity row (§13: never duplicate a Message-ID). History rule:
        // only explicit force touches an existing message row.
        threadId,
        subject: row.subjectOriginal,
        sentAt: row.sentAt ? new Date(row.sentAt) : null,
        bodyText: row.bodyText,
        bodyHtml: row.bodyHtmlRaw,
        headersRaw: row.headersRaw as never,
        replyTo: row.replyTo,
      },
    });

    // Recipients â€” kind fixed by position, never by array order bookkeeping later.
    const recipientRows = [
      ...row.to.map((p, i) => ({ kind: "TO" as const, email: (p.email ?? "missing@invalid").toLowerCase(), name: p.name, participantId: toParticipants[i]?.id ?? null })),
      ...row.cc.map((p, i) => ({ kind: "CC" as const, email: (p.email ?? "missing@invalid").toLowerCase(), name: p.name, participantId: ccParticipants[i]?.id ?? null })),
      ...row.bcc.map((p, i) => ({ kind: "BCC" as const, email: (p.email ?? "missing@invalid").toLowerCase(), name: p.name, participantId: bccParticipants[i]?.id ?? null })),
    ];
    await tx.emailRecipient.createMany({
      data: recipientRows.map((r) => ({ messageId: message.id, kind: r.kind, participantId: r.participantId, email: r.email, name: r.name })),
      skipDuplicates: true,
    });

    // Attachments â€” bytes are already on disk (validation phase); link metadata.
    const pendingId = (await tx.masterValue.findUnique({ where: { domain_value: { domain: "attachment_status", value: "pending" } } }))?.id;
    if (!pendingId) throw new AppError("INTERNAL_ERROR", 500, "attachment_status master value missing.");
    await tx.emailAttachment.createMany({
      data: row.attachments.map((a) => ({
        messageId: message.id,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        storageReference: a.storageReference,
        sha256: a.sha256,
        processingStatus: pendingId,
      })),
      skipDuplicates: true,
    });

    const completed = await tx.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "completed" } } });
    if (!completed) throw new AppError("INTERNAL_ERROR", 500, "job_status/completed missing.");
    await tx.importJob.update({
      where: { id: job.id },
      data: {
        status: completed.id,
        completedAt: new Date(),
        rowsProcessed: 1,
        rowsFailed: 0,
        warningCount: row.warnings.length,
        summary: { threadId, messageId: row.messageIdSynthetic, threadReason: threadResult.reason, forced: Boolean(params.force) } as never,
      },
    });

    return { threadId, messageId: message.id, threadReason: threadResult.reason, warnings: row.warnings };
  });

  await recordAudit({
    action: "eml_upload.confirmed",
    entityType: "EmailThread",
    entityId: result.threadId,
    newValue: JSON.stringify({ filename: job.filename, threadReason: result.threadReason, forced: Boolean(params.force) }),
    source: "HUMAN",
    actorUserId: params.userId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });
  logger.info("eml_upload.confirmed", { jobId: params.jobId, threadId: result.threadId, actorUserId: params.userId });

  return { threadId: result.threadId, messageId: result.messageId, threadReason: result.threadReason, forced: Boolean(params.force) };
}

function participantKeyOf(row: EmlRowPreview): string {
  const emails = [row.from?.email, ...row.to.map((p) => p.email), ...row.cc.map((p) => p.email), ...row.bcc.map((p) => p.email)]
    .filter((e): e is string => Boolean(e))
    .map((e) => e.toLowerCase());
  const unique = [...new Set(emails)].sort();
  return unique.length ? `p:${unique.join("|")}` : "";
}

async function resolveThreadRowTx(row: EmlRowPreview, applicationId: number | null, tx: Prisma.TransactionClient): Promise<ThreadMatch> {
  const parsedShim: ParsedEml = {
    normalized: {
      messageId: row.messageIdSynthetic,
      messageIdOriginal: row.messageIdOriginal,
      inReplyTo: row.inReplyTo,
      references: row.references,
      replyTo: row.replyTo,
      subjectOriginal: row.subjectOriginal,
      subjectNormalized: row.subjectNormalized,
      subjectHash: row.subjectHash,
      sentAt: row.sentAt ? new Date(row.sentAt) : null,
      from: row.from,
      to: row.to,
      cc: row.cc,
      bcc: row.bcc,
      mimeVersion: null,
      contentTypeHeader: null,
      contentTransferEncoding: null,
    },
    headersRaw: row.headersRaw,
    bodyText: row.bodyText,
    bodyHtmlRaw: row.bodyHtmlRaw,
    attachments: [],
    warnings: [],
    fileSha256: row.sha256,
  };
  return resolveThread(parsedShim, applicationId, tx);
}

async function ensureParticipantTx(tx: Prisma.TransactionClient, p: ParticipantLite | null, bodyHint?: string | null) {
  const unknownRole = await tx.masterValue.findUnique({ where: { domain_value: { domain: "participant_role", value: "unknown" } } });
  if (!unknownRole) throw new AppError("INTERNAL_ERROR", 500, "participant_role master value missing.");

  // User-requested AUTO role detection from the .eml itself — deterministic
  // rule classifier (vendor domain / body language). No evidence stays UNKNOWN.
  // Strip quoted reply chains (Outlook's "____" separator and everything after)
  // so role inference keys off the participant's OWN words, not the thread
  // history they happened to forward.
  const cleanBodyHint = bodyHint
    ? bodyHint.split(/_{5,}/)[0].slice(0, 2000).trim() || null
    : null;
  const inference = p?.email ? (await import("./role-rules")).inferParticipantRoleFromEml({ email: p.email, name: p.name, bodyHint: cleanBodyHint }) : null;
  const resolved = inference
    ? await tx.masterValue.findUnique({ where: { domain_value: { domain: "participant_role", value: inference.role } } })
    : null;

  if (!p?.email) {
    // Section 14: unusable address — recorded WITHOUT a mailable identity marker.
    const placeholder = `unknown-${sha256Buffer(JSON.stringify({ n: p?.name ?? "", t: Date.now() })).slice(0, 12)}@missing.invalid`;
    return tx.emailParticipant.create({
      data: {
        emailAddress: placeholder,
        name: p?.name ?? "(unknown)",
        displayName: p?.name ?? "(unknown)",
        role: unknownRole.id,
        roleSource: "UNKNOWN",
      },
    });
  }
  const email = p.email.toLowerCase().trim();
  const existing = await tx.emailParticipant.findUnique({ where: { emailAddress: email } });
  if (existing) {
    // Promote an UNKNOWN participant when deterministic evidence now exists.
    // Human overrides always win (checked above); humans may still correct later.
    if (resolved && existing.roleSource === "UNKNOWN" && existing.humanOverrideRole === null) {
      const updated = await tx.emailParticipant.update({
        where: { id: existing.id },
        data: { role: resolved.id, roleSource: "RULE", confidence: inference!.confidence },
      });
      return updated;
    }
    return existing;
  }
  return tx.emailParticipant.create({
    data: {
      emailAddress: email,
      name: p.name ?? email,
      displayName: p.name ?? email,
      role: resolved ? resolved.id : unknownRole.id,
      roleSource: resolved ? "RULE" : "UNKNOWN",
      confidence: resolved ? inference!.confidence : null,
    },
  });
}

