/**
 * Thread reconstruction (Phase 4 §14-§17) — deterministic, ordered precedence:
 *   1. Known Message-ID → the thread of the existing message
 *   2. In-Reply-To / References → newest ancestor by Message-ID
 *   3. (normalized subject + application) key
 *   4. participant-overlap fallback when no application context exists (§17:
 *      identical normalized subjects are NOT merged without a shared
 *      participant or explicit application linkage)
 *
 * Returns match metadata so the preview can show WHY a thread was chosen.
 */
import type { ParsedEml } from "@/lib/eml/parser";
import type { Prisma } from "@prisma/client";

export interface ThreadMatch {
  threadId: number | null;
  reason:
    | "message_id_known"
    | "in_reply_to_ancestor"
    | "references_ancestor"
    | "subject_application_key"
    | "subject_participant_overlap"
    | "new_thread";
  applicationId: number | null;
  warnings: string[];
}

function participantKey(emails: string[]): string {
  const unique = [...new Set(emails.filter(Boolean))].sort();
  return unique.length ? `p:${unique.join("|")}` : "";
}

/** All address strings of the parsed message (participants-level signal §14/§17). */
function emailsOf(parsed: ParsedEml): string[] {
  const collect: string[] = [];
  const push = (p: { email: string | null } | null) => {
    if (p?.email) collect.push(p.email);
  };
  push(parsed.normalized.from);
  parsed.normalized.to.forEach(push);
  parsed.normalized.cc.forEach(push);
  parsed.normalized.bcc.forEach(push);
  return collect;
}

export async function resolveThread(parsed: ParsedEml, declaredApplicationId: number | null, tx: Prisma.TransactionClient): Promise<ThreadMatch> {
  const warnings: string[] = [];

  // 1) Known message-id inside this ingestion set (§14 priority 1).
  const known = await tx.emailMessage.findUnique({
    where: { messageId: parsed.normalized.messageId },
    select: { threadId: true },
  });
  if (known) {
    return { threadId: known.threadId, reason: "message_id_known", applicationId: await threadApplication(known.threadId, tx), warnings };
  }

  // 2) In-Reply-To ancestry (§14 priority 2).
  if (parsed.normalized.inReplyTo) {
    const ancestor = await tx.emailMessage.findFirst({
      where: { messageId: { equals: parsed.normalized.inReplyTo.trim() } },
      orderBy: { id: "desc" },
      select: { threadId: true },
    });
    if (ancestor) {
      return { threadId: ancestor.threadId, reason: "in_reply_to_ancestor", applicationId: await threadApplication(ancestor.threadId, tx), warnings };
    }
  }

  // 3) References ancestry — newest ancestor wins (§14 priority 3).
  for (const ref of [...parsed.normalized.references].reverse()) {
    const ancestor = await tx.emailMessage.findFirst({
      where: { messageId: { equals: ref.trim() } },
      orderBy: { id: "desc" },
      select: { threadId: true },
    });
    if (ancestor) {
      return { threadId: ancestor.threadId, reason: "references_ancestor", applicationId: await threadApplication(ancestor.threadId, tx), warnings };
    }
  }

  // 4) Normalized subject + application (§16: never subject alone).
  const subjectKeyWhere = {
    subjectHash: { equals: parsed.normalized.subjectHash },
    applicationId: declaredApplicationId,
  } as Prisma.EmailThreadWhereInput;

  if (declaredApplicationId !== null) {
    const byApp = await tx.emailThread.findFirst({ where: subjectKeyWhere, orderBy: { updatedAt: "desc" } });
    if (byApp) {
      return { threadId: byApp.id, reason: "subject_application_key", applicationId: declaredApplicationId, warnings };
    }
  } else {
    // §17 — identical normalized subject WITHOUT application context must NOT
    // merge unless a participant overlaps that thread.
    const sameSubject = await tx.emailThread.findMany({ where: { subjectHash: { equals: parsed.normalized.subjectHash } }, orderBy: { updatedAt: "desc" }, take: 20 });
    const myEmails = emailsOf(parsed);
    const myKey = participantKey(myEmails);
    for (const thread of sameSubject) {
      if (!myKey) break;
      if (thread.participantKey === myKey) {
        return { threadId: thread.id, reason: "subject_participant_overlap", applicationId: thread.applicationId, warnings };
      }
      const threadParticipants = await tx.emailParticipant.findMany({
        where: {
          OR: [
            { messagesFrom: { some: { threadId: thread.id } } },
            { recipients: { some: { message: { threadId: thread.id } } } },
          ],
        },
        select: { emailAddress: true },
        take: 50,
      });
      const overlap = threadParticipants.some((p) => myEmails.includes(p.emailAddress));
      if (overlap) {
        return { threadId: thread.id, reason: "subject_participant_overlap", applicationId: thread.applicationId, warnings };
      }
    }
    warnings.push("No application linkage and no participant overlap with same-subject threads — new standalone thread.");
  }

  return { threadId: null, reason: "new_thread", applicationId: declaredApplicationId, warnings };
}

async function threadApplication(threadId: number, tx: Prisma.TransactionClient): Promise<number | null> {
  const t = await tx.emailThread.findUnique({ where: { id: threadId }, select: { applicationId: true } });
  return t?.applicationId ?? null;
}
