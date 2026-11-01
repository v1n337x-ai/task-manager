/**
 * EML parser (Phase 4 §11-§13) — `mailparser` (mature MIME library; no
 * hand-rolled MIME). Produces a normalized structure WHILE the DB row remains
 * an interpretation: raw headers are preserved (§2) bodies/attachments are
 * extracted; Message-ID absence/malformation is handled deterministically (§13).
 */
import { simpleParser, type ParsedMail, type Attachment } from "mailparser";
import { normalizeSubjectForThread, subjectHash } from "@/lib/services/email-foundation-service";
import { sha256Buffer } from "@/lib/eml/storage";

export interface ParsedParticipant {
  name: string | null;
  email: string | null;
}

export interface ParsedAttachment {
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  sha256: string;
  contentId: string | null;
  isInline: boolean;
  content: Buffer;
}

export interface ParsedEml {
  normalized: {
    messageId: string; // synthesized deterministic value when absent (§13)
    messageIdOriginal: string | null;
    inReplyTo: string | null;
    references: string[];
    replyTo: string | null;
    subjectOriginal: string | null;
    subjectNormalized: string;
    subjectHash: string;
    sentAt: Date | null;
    from: ParsedParticipant | null;
    to: ParsedParticipant[];
    cc: ParsedParticipant[];
    bcc: ParsedParticipant[];
    mimeVersion: string | null;
    contentTypeHeader: string | null;
    contentTransferEncoding: string | null;
  };
  headersRaw: Record<string, unknown>; // PRESERVED original headers (§2/§12)
  bodyText: string | null;
  bodyHtmlRaw: string | null; // NEVER sent to a browser unsanitized (§7)
  attachments: ParsedAttachment[];
  warnings: string[];
  fileSha256: string;
}

function participantFromAddress(value: unknown): ParsedParticipant | null {
  const first = (value as { value?: { address?: string; name?: string }[] } | undefined)?.value?.[0];
  if (!first?.address) return null;
  return { name: first.name ?? null, email: first.address.toLowerCase() };
}

function participants(value: unknown): ParsedParticipant[] {
  return ((value as { value?: { address?: string; name?: string }[] } | undefined)?.value ?? [])
    .filter((p) => p.address)
    .map((p) => ({ email: p.address!.toLowerCase(), name: p.name ?? null }));
}

function messageIdOrSynthetic(parsed: ParsedMail, content: Buffer): { id: string; original: string | null; warning?: string } {
  const raw = parsed.messageId?.trim();
  if (raw && /^<.*>$/.test(raw) && !raw.includes(" ")) {
    return { id: raw, original: raw };
  }
  if (raw) {
    // Malformed but non-empty: preserve concept but uniq'ed deterministically (§13).
    const synthesized = `<malformed-${sha256Buffer(`${raw}|${content.length}`)}@task-manager.invalid>`;
    return { id: synthesized, original: raw, warning: "Message-ID was malformed — a deterministic identifier was synthesized; the original is preserved in headersRaw." };
  }
  // Absent: content-hash identity (same file re-uploaded still dedupes via file sha256).
  return { id: `<synth-${sha256Buffer(content)}@task-manager.invalid>`, original: null, warning: "Message-ID absent — a deterministic identifier was synthesized from the file content." };
}

export async function parseEml(content: Buffer): Promise<ParsedEml> {
  let parsed: ParsedMail;
  try {
    // mailparser handles MIME/envelope decoding; options are majorité defaults.
    parsed = await simpleParser(content);
  } catch (error) {
    throw new Error(`EML parse failed (malformed MIME): ${String(error).slice(0, 200)}`);
  }

  const warnings: string[] = [];
  const subjectOriginal = parsed.subject ?? null;
  const normalized = subjectOriginal ? normalizeSubjectForThread(subjectOriginal) : "";
  if (subjectOriginal && !normalized) {
    warnings.push("Subject normalized to an empty key — thread matching falls back to references/message-id only.");
  }

  const idResult = messageIdOrSynthetic(parsed, content);
  if (idResult.warning) warnings.push(idResult.warning);

  const messageIdsFromReferences = (parsed.references as unknown as string[] | undefined) ?? [];
  const references = Array.isArray(messageIdsFromReferences)
    ? messageIdsFromReferences.filter((r) => typeof r === "string")
    : typeof parsed.references === "string"
      ? [parsed.references]
      : [];

  const attachments: ParsedAttachment[] = (parsed.attachments ?? []).map((a: Attachment) => {
    const content = a.content as Buffer;
    void a;
    return {
      filename: a.filename ?? "unnamed-attachment",
      contentType: a.contentType ?? null,
      sizeBytes: content?.length ?? 0,
      sha256: content ? sha256Buffer(content) : "",
      contentId: a.contentId ?? null,
      isInline: Boolean(a.contentDisposition === "inline" || a.contentId),
      content,
    };
  });

  // Raw headers preserved verbatim (§2/§12): mailparser `headers` is a Map —
  // Object.entries does NOT iterate it; iterate explicitly.
  const headersRaw: Record<string, unknown> = {};
  for (const [key, value] of parsed.headers as unknown as Iterable<[string, unknown]>) {
    const v = value as unknown;
    if (v === null || v === undefined) continue;
    if (typeof v === "object" && "text" in (v as object)) {
      headersRaw[key] = (v as { text?: string }).text;
    } else if (Array.isArray(v)) {
      headersRaw[key] = v;
    } else if (typeof v === "object" && "value" in (v as object)) {
      headersRaw[key] = String(JSON.stringify(v)).slice(0, 500);
    } else {
      headersRaw[key] = v;
    }
  }

  return {
    normalized: {
      messageId: idResult.id,
      messageIdOriginal: idResult.original,
      inReplyTo: (parsed.inReplyTo as string | undefined)?.trim() || null,
      references,
      replyTo: (parsed.replyTo as unknown as { text?: string } | undefined)?.text ?? null,
      subjectOriginal,
      subjectNormalized: normalized,
      subjectHash: subjectOriginal ? subjectHash(subjectOriginal) : `no-subject-${sha256Buffer(content)}`,
      sentAt: parsed.date ?? null,
      from: participantFromAddress(parsed.from),
      to: participants(parsed.to),
      cc: participants(parsed.cc),
      bcc: participants(parsed.bcc),
      mimeVersion: typeof parsed.headers.get("mime-version") === "object"
        ? (() => {
            const mv = parsed.headers.get("mime-version") as { value?: string | { value?: string }[] } | undefined;
            const inner = mv?.value;
            if (typeof inner === "string") return inner;
            if (Array.isArray(inner)) return (inner[0] as { value?: string } | undefined)?.value ?? null;
            return null;
          })()
        : null,
      contentTypeHeader: (() => {
        const ct = parsed.headers.get("content-type") as { params?: Record<string, string> } | undefined;
        void ct;
        return (parsed.headers.get("content-type") as { value?: string } | undefined) ? String((parsed.headers.get("content-type") as { value?: string }).value) : null;
      })(),
      contentTransferEncoding: (() => {
        const val = parsed.headers.get("content-transfer-encoding") as string | { value?: string } | undefined;
        if (!val) return null;
        if (typeof val === "string") return val;
        if (Array.isArray(val)) return (val[0] as { value?: string } | undefined)?.value ?? null;
        if ("value" in (val as object)) return (val as { value?: string }).value ?? null;
        return null;
      })(),
    },
    headersRaw,
    bodyText: typeof parsed.text === "string" ? parsed.text : null,
    bodyHtmlRaw: typeof parsed.html === "string" ? parsed.html : null,
    attachments,
    warnings,
    fileSha256: sha256Buffer(content),
  };
}
