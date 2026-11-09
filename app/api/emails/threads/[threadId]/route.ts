import { NextResponse, type NextRequest } from "next/server";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { sanitizeEmailHtml } from "@/lib/eml/sanitize";

/**
 * GET /api/emails/threads/[threadId] (Phase 4 §1) — reconstructed conversation:
 * messages in chronological order, participants with effective roles, raw
 * attachment metadata; HTML bodies are SANITIZED before they ever reach a client.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    await requireSessionH(request);
    const { threadId } = await params;
    const id = Number(threadId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid thread id." } }, { status: 422 });
    }

    const thread = await prisma.emailThread.findUnique({
      where: { id },
      include: {
        application: { select: { id: true, displayName: true } },
        messages: {
          orderBy: [{ sentAt: "asc" }, { id: "asc" }],
          include: {
            fromContact: { include: { roleRef: true, roleOverrideRef: true } },
            recipients: { include: { participant: { select: { displayName: true, emailAddress: true } } } },
            attachments: { orderBy: { filename: "asc" }, include: { processingStatusRef: true } },
          },
        },
      },
    });
    if (!thread) throw NotFoundError("Email thread");

    // Original upload filenames — map each stored message back to the .eml the
    // user imported (import_jobs preview holds messageIdSynthetic + filename),
    // so the UI can list the uploaded files in confirmation order (user ask).
    // PERF: only fetch the jobs that can match THIS thread's messages. Loading
    // every eml_batch job (2k rows / ~11 MB of JSON) made each click take ~3s.
    const messageIds = thread.messages.map((m) => m.messageId);
    const importJobs =
      messageIds.length === 0
        ? []
        : await prisma.importJob.findMany({
            where: {
              type: "eml_batch",
              OR: messageIds.map((id) => ({
                preview: { path: ["row", "messageIdSynthetic"], equals: id },
              })),
            },
            select: { filename: true, preview: true },
          });
    const fileBySyntheticId = new Map<string, string>();
    for (const j of importJobs) {
      const preview = j.preview as { row?: { messageIdSynthetic?: string; filename?: string } } | null;
      const syn = preview?.row?.messageIdSynthetic;
      if (syn && !fileBySyntheticId.has(syn)) fileBySyntheticId.set(syn, j.filename);
    }

    const messages = thread.messages.map((m) => ({
      id: m.id,
      messageId: m.messageId,
      subject: m.subject,
      sentAt: m.sentAt?.toISOString() ?? null,
      bodyText: m.bodyText ? m.bodyText.slice(0, 50_000) : null,
      bodyHtmlSanitized: sanitizeEmailHtml(m.bodyHtml),
      rawHeaders: m.headersRaw,
      sourceFile: m.sourceFile,
      uploadedFile: fileBySyntheticId.get(m.messageId) ?? null,
      from: {
        email: m.fromContact.emailAddress,
        displayName: m.fromContact.displayName,
        effectiveRole: m.fromContact.roleOverrideRef ? `${m.fromContact.roleOverrideRef.value} (human override)` : m.fromContact.roleRef.value,
        roleSource: m.fromContact.roleSource,
        confidence: m.fromContact.confidence,
      },
      recipients: m.recipients.map((r) => ({
        kind: r.kind,
        email: r.email,
        name: r.name,
        participantDisplayName: r.participant?.displayName ?? null,
      })),
      attachments: m.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        processingStatusRef: a.processingStatusRef.value,
        storageReference: a.storageReference,
      })),
    }));

    return NextResponse.json({
      thread: {
        id: thread.id,
        subject: thread.subject,
        subjectHash: thread.subjectHash,
        application: thread.application,
        applicationId: thread.applicationId,
        participantKey: thread.participantKey,
        createdAt: thread.createdAt.toISOString(),
        messageCount: messages.length,
      },
      messages,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
