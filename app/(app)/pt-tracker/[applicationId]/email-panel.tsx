"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AtSign, FilePlus2, Paperclip, Check, TriangleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SeverityFillCell } from "@/components/status-fill";
import { AiReview } from "./ai-review-panel";
import { PstImportButton } from "./pst-import-button";

function csrf(): string | null {
  const raw = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("tm_csrf="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

interface UploadPreviewItem {
  ok: boolean;
  jobId?: number;
  filename?: string;
  error?: string;
  duplicate?: boolean;
  preview?: {
    subjectOriginal: string | null;
    sentAt: string | null;
    from: { name: string | null; email: string | null } | null;
    to: { email: string | null }[];
    attachments: { filename: string; sizeBytes: number; sha256: string }[];
    threadMatch: { reason: string; threadId: number | null };
    warnings: string[];
  };
}

export function EmailPanel({
  applicationId,
  threads,
}: {
  applicationId: number;
  threads: ThreadSummary[];
}) {
  const router = useRouter();
  const [files, setFiles] = React.useState<File[]>([]);
  const [results, setResults] = React.useState<UploadPreviewItem[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [phase, setPhase] = React.useState<"idle" | "uploading" | "previewed">("idle");
  const [force, setForce] = React.useState(false);
  const [last, setLast] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [activeThread, setActiveThread] = React.useState<ThreadSummary | null>(threads[0] ?? null);
  const [threadDetail, setThreadDetail] = React.useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [pstOpen, setPstOpen] = React.useState(false);
  const threadLoadToken = React.useRef(0);

  async function upload() {
    if (files.length === 0) return;
    setBusy(true);
    setLast(null);
    setResults(null);
    const collected: UploadPreviewItem[] = [];
    try {
      // One request per file. A single multipart batch of 25 .eml files can
      // exceed the request-body cap and fail as a whole; per-file requests
      // isolate failures and let the user see progress.
      for (let i = 0; i < files.length; i += 1) {
        setProgress(`Parsing ${i + 1} of ${files.length}…`);
        const fd = new FormData();
        fd.set("applicationId", String(applicationId));
        fd.append("files", files[i]);
        try {
          const res = await fetch("/api/emails/upload", {
            method: "POST",
            body: fd,
            headers: csrf() ? { "x-csrf-token": csrf()! } : {},
          });
          const data = (await res.json().catch(() => null)) as
            | { error?: { message?: string }; results?: UploadPreviewItem[] }
            | null;
          if (!res.ok || !data?.results) {
            collected.push({
              ok: false,
              filename: files[i].name,
              error: data?.error?.message ?? `Upload failed (HTTP ${res.status}).`,
            });
            continue;
          }
          collected.push(...data.results);
        } catch (error) {
          collected.push({ ok: false, filename: files[i].name, error: (error as Error).message || "Upload failed." });
        }
      }
      const ready = collected.filter((r) => r.ok).length;
      setResults(collected);
      if (ready > 0) setPhase("previewed");
      setLast(`Parsed ${ready} of ${files.length} file(s). Review the previews, then confirm.`);
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const jobIds = (results ?? []).filter((r) => r.ok && r.jobId).map((r) => r.jobId as number);
      const res = await fetch("/api/emails/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: JSON.stringify({ jobIds, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLast(data.error?.message ?? "Confirm failed.");
        return;
      }
      const okCount = (data.results as { ok: boolean }[]).filter((r) => r.ok).length;
      setLast(`Confirmed ${okCount} email(s). Threads/messages/participants/attachments persisted.`);
      setResults(null);
      setFiles([]);
      setPhase("idle");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function openThread(thread: ThreadSummary) {
    const requestToken = ++threadLoadToken.current;
    setActiveThread(thread);
    setThreadDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/emails/threads/${thread.id}`);
      if (threadLoadToken.current !== requestToken) return;
      const data = await res.json();
      if (threadLoadToken.current !== requestToken) return;
      setThreadDetail(res.ok ? (data as ThreadDetail) : null);
    } catch (error) {
      if (threadLoadToken.current !== requestToken) return;
      setThreadDetail(null);
      setLast(`Could not load the conversation (${(error as Error).message}). Check the server and retry.`);
    } finally {
      if (threadLoadToken.current === requestToken) setDetailLoading(false);
    }
  }

  // Open the newest thread automatically so the enlarged conversation view is
  // visible immediately instead of showing only the thread list.
  React.useEffect(() => {
    const firstThread = threads[0];
    if (firstThread) void openThread(firstThread);
    // openThread is intentionally excluded: running it on every render would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads[0]?.id]);

  return (
    <div className="space-y-5">
      <section className="panel px-5 py-4" aria-label="EML upload">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Upload .EML files — or a .pst archive</h3>
          <div className="flex items-center gap-2">
            <Badge variant="muted">drag &amp; drop or picker · .eml or .pst</Badge>
            <button
              type="button"
              onClick={() => setPstOpen((v) => !v)}
              className="border border-stroke bg-xlsx-band px-3 py-2 text-[13px] font-semibold text-ink-2 transition hover:bg-xlsx-data"
            >
              Import .pst
            </button>
          </div>
        </div>
        {pstOpen ? (
          <div className="mt-3 border-t border-stroke pt-3">
            <PstImportButton applicationId={applicationId} />
          </div>
        ) : null}
        <p className="mt-1 text-[13px] text-muted">
          Original files are preserved verbatim (sha256) with full headers. Parsing is deterministic (Message-ID →
          In-Reply-To → References → normalized subject + participants); nothing is written until you confirm.
        </p>
        <div
          className="mt-3 rounded-xl border-2 border-dashed border-stroke bg-tint-b px-4 py-6 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith(".eml"));
            setFiles((prev) => [...prev, ...dropped]);
          }}
        >
          <FilePlus2 className="mx-auto h-6 w-6 text-muted" aria-hidden />
          <input
            type="file"
            accept=".eml"
            multiple
            className="mx-auto mt-2 block rounded-lg border border-stroke bg-card px-3 py-2 text-[13px]"
            onChange={(e) => setFiles([...e.target.files ?? []])}
          />
          {files.length > 0 ? <p className="mt-2 text-[12px] text-muted">{files.length} file(s) staged</p> : null}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="accent" onClick={upload} disabled={busy || files.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <AtSign className="h-4 w-4" aria-hidden />}
            {busy ? (progress ?? "Parsing…") : "Parse"}
          </Button>
          {phase === "previewed" ? (
            <Button variant="primary" onClick={confirm} disabled={busy}>
              <Check className="h-4 w-4" aria-hidden /> Confirm import
            </Button>
          ) : null}
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Reprocess duplicates (force)
          </label>
        </div>

        {last ? <p role="status" className="mt-3 rounded-md border border-stroke bg-band px-3 py-2 text-[13px] text-ink-2">{last}</p> : null}

        {results ? (
          <ul className="mt-3 space-y-2">
            {results.map((r, i) => (
              <li key={i} className={cn("rounded-lg border px-3 py-2 text-[13px]", r.ok ? "border-stroke bg-card" : "border-danger/40 bg-danger/5")}>
                {r.ok ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{r.preview?.subjectOriginal ?? r.filename}</span>
                      {r.duplicate ? <Badge variant="hold">Duplicate EML detected</Badge> : <Badge variant="good">Ready</Badge>}
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted">
                      from {r.preview?.from?.email ?? "?"} · {r.preview?.to.length ?? 0} recipients · {r.preview?.attachments.length ?? 0} attachments ·
                      thread: {r.preview?.threadMatch.reason ?? "new_thread"}
                    </p>
                    {(r.preview?.warnings.length ?? 0) > 0 ? <p className="mt-1 text-[12px] text-danger">{r.preview!.warnings.join(" · ")}</p> : null}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-danger">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                      <span className="font-medium">{r.filename}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-danger">{r.error}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-label="Conversation threads" className="min-w-0">
        <div className="mb-5 rounded-2xl border border-stroke-soft bg-card shadow-[0_14px_36px_rgb(243_112_33/8%)]">
          <div className="flex flex-wrap items-center gap-3 border-b border-stroke-soft px-5 py-4">
            <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink">Conversation</h3>
            <Badge variant="muted">{threads.length} thread{threads.length === 1 ? "" : "s"}</Badge>
            <label className="sr-only" htmlFor="conversation-thread-select">Select conversation thread</label>
            <select
              id="conversation-thread-select"
              value={activeThread?.id ?? ""}
              onChange={(event) => {
                const next = threads.find((t) => t.id === Number(event.target.value));
                if (next) void openThread(next);
              }}
              className="min-w-0 flex-1 rounded-xl border border-stroke-soft bg-white px-3 py-2 text-[13px] font-medium text-ink shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 sm:min-w-[320px]"
              disabled={threads.length === 0}
            >
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.subject} · {t.messageCount} message(s)
                </option>
              ))}
            </select>
            <span className="text-[12px] text-muted">
              {activeThread?.lastSentAt ? `Last ${new Date(activeThread.lastSentAt).toLocaleDateString("en-GB")}` : ""}
            </span>
          </div>

          {threads.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto px-4 py-3" aria-label="Available threads">
              {threads.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void openThread(t)}
                  aria-current={activeThread?.id === t.id ? "true" : undefined}
                  className={cn(
                    "shrink-0 rounded-full border px-3.5 py-2 text-[12px] font-semibold transition",
                    activeThread?.id === t.id
                      ? "border-accent bg-gradient-to-r from-accent-soft to-[#f6edff] text-ink shadow-sm"
                      : "border-stroke-soft bg-white text-ink-2 hover:border-accent/40 hover:bg-accent-soft",
                  )}
                >
                  {t.subject}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 overflow-hidden rounded-2xl border border-stroke-soft bg-card shadow-[0_14px_36px_rgb(243_112_33/8%)]">
          {detailLoading ? (
            <p className="px-6 py-16 text-center text-[13px] text-muted">Loading conversation…</p>
          ) : !threadDetail ? (
            <p className="px-6 py-16 text-center text-[13px] text-muted">Select a thread to read the reconstructed conversation.</p>
          ) : (
            <ChatThread
              subject={threadDetail.thread.subject}
              appDisplayName={threadDetail.thread.application?.displayName ?? null}
              messages={threadDetail.messages}
            />
          )}
        </div>
      </section>

      {activeThread ? <AiReview threadId={activeThread.id} threadSubject={activeThread.subject} /> : null}
    </div>
  );
}

export interface ThreadSummary {
  id: number;
  subject: string;
  messageCount: number;
  lastSentAt: string | null;
}

interface ThreadDetail {
  thread: { id: number; subject: string; application?: { displayName: string } | null; messageCount: number };
  messages: ChatMessage[];
}

/** WhatsApp/Messenger-style conversation (originals stay verbatim + sha256). */
interface ChatMessage {
  id: number;
  messageId: string;
  subject: string | null;
  sentAt: string | null;
  bodyText: string | null;
  bodyHtmlSanitized: string | null;
  sourceFile: string | null;
  uploadedFile?: string | null; // the original .eml the user imported (order №)
  from: { email: string; displayName: string; effectiveRole: string; roleSource?: string | null; confidence?: number | null };
  recipients: { kind: string; email: string; name: string | null }[];
  attachments: { id: number; filename: string; sizeBytes: number | null }[];
}

const ROLE_META: Record<string, { label: string; badge: string; dot: string; side: "left" | "right" }> = {
  pentester: { label: "PENTESTER", badge: "bg-sev-critical text-sev-critical-text", dot: "#C1272D", side: "left" },
  developer: { label: "DEVELOPER", badge: "bg-sev-info text-sev-info-text", dot: "#0070C0", side: "right" },
  application_owner: { label: "APP OWNER", badge: "bg-slate text-white", dot: "#44546A", side: "left" },
  management: { label: "MANAGEMENT", badge: "bg-slate text-white", dot: "#44546A", side: "left" },
  security_team: { label: "SECURITY", badge: "bg-sev-low text-sev-low-text", dot: "#39B54A", side: "left" },
  other: { label: "OTHER", badge: "bg-xlsx-band text-ink", dot: "#7a7a7a", side: "left" },
  unknown: { label: "ROLE UNKNOWN", badge: "bg-band text-muted", dot: "#7a7a7a", side: "left" },
};

/** Two-sided thread convention: LEFT = Task Manager defense + pentester (assessment
 * side), RIGHT = vendor developers. EVERY role maps into a side — no orphans. */
const LEFT_SIDE = new Set(["pentester", "security_team", "application_owner", "management", "other", "unknown"]);

function sideOf(effectiveRole: string): "left" | "right" {
  const key = effectiveRole.replace(/\s*\(human override\)\s*/i, "").trim();
  return LEFT_SIDE.has(key) ? "left" : "right";
}

function roleMeta(effectiveRole: string) {
  const key = effectiveRole.replace(/\s*\(human override\)\s*/i, "").trim();
  let base = ROLE_META[key];
  if (!base) {
    base = { label: key.toUpperCase(), badge: "bg-band text-ink-2", dot: "#7a7a7a", side: "left" };
  }
  if (effectiveRole.includes("human")) {
    return { label: `HUMAN · ${key.toUpperCase()}`, badge: "bg-sev-low text-sev-low-text", dot: "#39B54A", side: sideOf(key) };
  }
  return { ...base, side: sideOf(key) };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * NeatTextBody — renders raw .eml text bodies the way WhatsApp threads read:
 * Outlook forwarded-header blocks ("From: … / Sent: … / To: … / Subject: …")
 * become a small labeled ENVELOPE card (with wrapped-line continuation merged,
 * e.g. a long Subject split over two lines), and the remaining content renders
 * as tidy paragraphs/bullets. The original bytes are untouched — this only
 * changes the RENDER.
 */
const HEADER_LINE = /^\s*>?\s*(from|sent|to|cc|bcc|subject|date|importance|attachments)\s*:\s*(.*)$/i;
const ADDRESS_LABEL = /^(from|to|cc|bcc)$/i;

/**
 * Outlook writes addresses as `Name <addr@x.com <mailto:addr@x.com> >`. The
 * stored bytes must stay untouched, but the reader should only ever see
 * `Name` plus the plain address — so strip the duplicate mailto wrapper and
 * any stray outer brackets before rendering.
 */
function cleanMailto(value: string): string {
  return value
    .replace(/<\s*mailto:[^>]*>/gi, " ")
    .replace(/[<>]/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Body copy also carries Outlook's mention syntax (`@Name <mailto:addr>`).
 * The address is already visible in the bubble's From/To header, so drop the
 * wrapper and leave a clean `@Name`.
 */
function cleanBodyText(line: string): string {
  return line
    .replace(/<\s*mailto:[^>]*>/gi, "")
    // Drop Outlook's safelinks tracking wrapper; the readable URL usually
    // precedes it, and the encoded %7C payload is pure noise.
    .replace(/\s*<https?:\/\/[^>\s]*safelinks\.protection\.outlook\.com[^>]*>/gi, "")
    .replace(/([A-Za-z])\((Consultant)\)/gi, "$1 ($2)")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .trimEnd();
}

/** "Khalkho(Consultant)" → "Khalkho (Consultant)". */
function tidyName(name: string): string {
  return cleanMailto(name)
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)/g, ")")
    .trim();
}

interface Recipient {
  name: string;
  email: string;
}

/**
 * Split a To/Cc/Bcc/From header into readable recipients. Handles `;` and
 * comma separators (only outside angle brackets), drops the mailto duplicate,
 * and de-duplicates by address.
 */
function parseRecipients(value: string): Recipient[] {
  const raw = value.replace(/<\s*mailto:[^>]*>/gi, " ");
  const parts: string[] = [];
  let depth = 0;
  let buf = "";

  for (const ch of raw) {
    if (ch === "<") depth += 1;
    else if (ch === ">") depth = Math.max(0, depth - 1);
    if ((ch === ";" || ch === ",") && depth === 0) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf);

  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const part of parts) {
    const text = part.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const email = (text.match(/[^\s<>;,:"]+@[^\s<>;,:"]+/)?.[0] ?? "").replace(/[.,;:]+$/, "");
    const withoutEmail = email ? text.replace(email, " ") : text;
    const name = tidyName(withoutEmail.replace(/<[^>]*>/g, " "));
    const key = (email || name).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: name || email, email });
  }
  return out;
}

type NeatBlock = { type: "envelope"; pairs: [string, string][] } | { type: "text"; text: string } | { type: "summaryTable"; rows: SummaryTableRow[]; statusLabels: string[] };

interface SummaryTableRow {
  no: number;
  title: string;
  severity: string;
  statuses: string[];
}

const SUMMARY_TABLE_HEADER = /^\s*(?:#|s(?:r)?\.?\s*no\.?|sno|no\.?)\s*(?:[|\t;]\s*|\s+)(?:name\s+of\s+(?:the\s+)?vulnerab\w*|vulnerability(?:\s+name)?|finding|issue|title|test\s+case|name)\s*(?:[|\t;]\s*|\s+)(?:severity|risk|impact)\s*(?:[|\t;]\s*|\s+)(?:(?:uat|prod)\s+)?(?:status|current\s+status|state|verdict|result)(?:\s*(?:[|\t;]\s*|\s+)(?:(?:uat|prod)\s+)?(?:status|current\s+status|state|verdict|result))?\s*$/i;
const SUMMARY_TABLE_ROW_START = /^\s*\|?\s*(\d{1,3})(?:[\s.).|]+)\s*\S/;
const SUMMARY_TABLE_END = /^\s*(from|sent|subject|regards|best\s+regards|thanks|regards,|thanks,)\s*:/i;

const SUMMARY_SEVERITIES = ["critical", "high", "medium", "low", "info"];

export function parseSummaryTableRow(raw: string, statusLabels: string[] = ["Status"]): SummaryTableRow | null {
  const normalizedRaw = raw.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  const match = normalizedRaw.match(/^(\d{1,3})(?:\s+|[.)]\s*)(.+)$/s);
  if (!match) return null;
  const no = Number(match[1]);
  let rest = match[2].replace(/\s+/g, " ").trim();

  const statuses: string[] = [];
  while (statuses.length < statusLabels.length) {
    const statusMatch = rest.match(/\s*(Not Fixed \/ New Finding|Not Fixed|New Finding|Accepted Risk|Not Retested|Out of Scope|Not Applicable|Not Mitigated|Reopened|Remediated|Mitigated|Pending|Open|Fixed|Closed|CAR|Removed)\s*$/i);
    if (!statusMatch) break;
    statuses.unshift(statusMatch[1]);
    rest = rest.slice(0, -statusMatch[0].length).trim();
  }
  while (statuses.length < statusLabels.length) statuses.push("—");

  let severity = "unknown";
  for (const candidate of SUMMARY_SEVERITIES) {
    const severityMatch = rest.match(new RegExp(`\\s*${candidate}\\s*$`, "i"));
    if (severityMatch) {
      severity = candidate;
      rest = rest.slice(0, -severityMatch[0].length).trim();
      break;
    }
  }

  const title = rest.replace(/^\s*[-–—]\s*/, "").trim();
  if (!title) return null;
  return { no, title, severity, statuses };
}

function summaryTableStatusLabels(line: string): string[] {
  const severityMatch = line.toLowerCase().match(/\b(?:severity|risk|impact)\b/);
  if (!severityMatch?.index) return [];
  const rest = line.slice(severityMatch.index + severityMatch[0].length).replace(/^[|\t;:\-\s]*/, "");
  const labels: string[] = [];
  for (const labelMatch of rest.matchAll(/(uat\s+status|prod\s+status|status|current\s+status|state|verdict|result)/gi)) {
    labels.push(labelMatch[0].replace(/\s+/g, " ").trim());
  }
  return labels;
}

function summaryTableStatusLabelsAt(lines: string[], index: number): { start: number; labels: string[] } | null {
  const labels: string[] = [];
  let cursor = index + 3;
  while (cursor < lines.length) {
    const line = lines[cursor]?.trim() ?? "";
    if (!/^(?:uat\s+status|prod\s+status|status|current\s+status|state|verdict|result)$/i.test(line)) break;
    labels.push(line.replace(/\s+/g, " ").trim());
    cursor += 1;
  }
  if (labels.length === 0) return null;
  return { start: cursor, labels };
}

function parseVerticalSummaryTable(lines: string[], start: number, statusLabels: string[]): { rows: SummaryTableRow[]; nextIndex: number } {
  const rows: SummaryTableRow[] = [];
  let i = start;

  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === "") i += 1;
    const numberMatch = lines[i]?.match(/^\s*\|?\s*(\d{1,3})\s*\|?\s*$/);
    if (!numberMatch) break;
    const no = Number(numberMatch[1]);
    i += 1;

    const titleLines: string[] = [];
    while (i < lines.length) {
      const candidate = lines[i]!.trim();
      if (SUMMARY_SEVERITIES.includes(candidate.toLowerCase())) break;
      if (/^\|?\s*\d{1,3}\s*\|?\s*$/.test(candidate)) break;
      if (candidate) titleLines.push(candidate);
      i += 1;
    }
    const severity = lines[i]?.trim().toLowerCase() ?? "unknown";
    i += 1;
    const statuses: string[] = [];
    for (let statusIndex = 0; statusIndex < statusLabels.length; statusIndex += 1) {
      const statusCandidate = lines[i]?.trim() ?? "";
      if (/^(not fixed \/ new finding|not fixed|new finding|accepted risk|not retested|out of scope|not applicable|not mitigated|reopened|remediated|mitigated|pending|open|fixed|closed|car|removed)$/i.test(statusCandidate)) {
        statuses.push(statusCandidate);
        i += 1;
      } else statuses.push("—");
    }
    const title = titleLines.join(" ").trim();
    if (title) rows.push({ no, title, severity, statuses });
  }
  return { rows, nextIndex: i };
}

export function parseSummaryTable(lines: string[], start: number, statusLabels: string[] = ["Status"]): { rows: SummaryTableRow[]; nextIndex: number } {
  const rows: SummaryTableRow[] = [];
  let current: string | null = null;
  let i = start;

  const flush = () => {
    if (!current) return;
    const row = parseSummaryTableRow(current, statusLabels);
    if (row) rows.push(row);
    current = null;
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      let next = i + 1;
      while (next < lines.length && lines[next]!.trim() === "") next += 1;
      if (next < lines.length && SUMMARY_TABLE_ROW_START.test(lines[next]!)) {
        i = next;
        continue;
      }
      break;
    }
    if (SUMMARY_TABLE_END.test(line)) break;

    if (SUMMARY_TABLE_ROW_START.test(line)) {
      flush();
      current = line.trim();
    } else if (current) {
      current += ` ${line.trim()}`;
    } else {
      break;
    }
    i += 1;
  }
  flush();
  return { rows, nextIndex: Math.max(i, start + 1) };
}

export function parseNeatBlocks(body: string): NeatBlock[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: NeatBlock[] = [];
  let textBuf: string[] = [];
  let envelope: [string, string][] | null = null;

  const pushText = () => {
    if (textBuf.length) {
      const text = textBuf.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (text) blocks.push({ type: "text", text });
      textBuf = [];
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!.replace(/\s+$/, "");
    if (SUMMARY_TABLE_HEADER.test(line)) {
      pushText();
      const statusLabels = summaryTableStatusLabels(line);
      const table = parseSummaryTable(lines, lineIndex + 1, statusLabels.length ? statusLabels : ["Status"]);
      if (table.rows.length > 0) {
        blocks.push({ type: "summaryTable", rows: table.rows, statusLabels: statusLabels.length ? statusLabels : ["Status"] });
        lineIndex = table.nextIndex - 1;
        continue;
      }
    }
    const verticalHeader = summaryTableStatusLabelsAt(lines, lineIndex);
    if (verticalHeader) {
      pushText();
      const table = parseVerticalSummaryTable(lines, verticalHeader.start, verticalHeader.labels);
      if (table.rows.length > 0) {
        blocks.push({ type: "summaryTable", rows: table.rows, statusLabels: verticalHeader.labels });
        lineIndex = table.nextIndex - 1;
        continue;
      }
    }
    const m = line.match(HEADER_LINE);
    if (m) {
      pushText();
      // A header line always starts (or continues) an envelope block. Reuse the
      // trailing envelope if the previous block is one, else open a new one.
      const prev = blocks[blocks.length - 1];
      let pairs: [string, string][];
      if (prev && prev.type === "envelope") {
        pairs = prev.pairs;
      } else {
        pairs = [];
        blocks.push({ type: "envelope", pairs });
      }
      const label = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
      pairs.push([label, m[2]!.trim()]);
      envelope = pairs;
      continue;
    }
    if (envelope) {
      // A blank line or the start of quoted body text ends the header block.
      if (line.trim() === "" || /^\s*>/.test(line)) {
        envelope = null;
        if (line.trim() === "") continue;
      } else {
        // Values wrap; keep absorbing until a blank line.
        const last = envelope[envelope.length - 1];
        if (last) last[1] = `${last[1]} ${line.trim()}`.trim();
        continue;
      }
    }
    textBuf.push(line.replace(/^\s*>\s?/, ""));
  }
  pushText();
  return blocks;
}

/**
 * Compact recipient line: names only by default, emails behind an explicit
 * expander. A 15-person To line stays two lines instead of thirty.
 */
function RecipientList({ recipients, showEmails = false }: { recipients: Recipient[]; showEmails?: boolean }) {
  const [expanded, setExpanded] = React.useState(false);
  const limit = 4;
  const hasMore = recipients.length > limit;
  const shown = hasMore && !expanded ? recipients.slice(0, limit) : recipients;

  return (
    <span>
      {shown.map((r, k) => (
        <React.Fragment key={k}>
          {k > 0 ? <span className="text-muted">; </span> : null}
          <span className="whitespace-nowrap" title={r.email || undefined}>
            {r.name}
          </span>
          {(expanded || showEmails) && r.email && r.email.toLowerCase() !== r.name.toLowerCase() ? (
            <span className="text-[11px] text-muted"> {r.email}</span>
          ) : null}
        </React.Fragment>
      ))}
      {hasMore ? (
        <>
          {" "}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-medium text-ink-2 underline decoration-dotted underline-offset-2"
          >
            {expanded ? "show less" : `+${recipients.length - limit} more`}
          </button>
        </>
      ) : null}
    </span>
  );
}

function renderNeatBlocks(blocks: NeatBlock[], offset = 0) {
  return blocks.map((b, i) => {
    const key = offset + i;
    if (b.type === "summaryTable") {
      return (
        <div key={`summary${key}`} className="overflow-hidden rounded-2xl border border-stroke-soft bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="vapt-summary-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Name of the vulnerability</th>
                  <th scope="col">Severity</th>
                  {b.statusLabels.map((label) => <th key={label} scope="col">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row) => (
                  <tr key={row.no}>
                    <td><span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-accent-soft px-1.5 text-[12px] font-bold text-accent-deep">{row.no}</span></td>
                    <td className="font-semibold text-ink">{row.title}</td>
                    <td className="filled-cell"><SeverityFillCell severityValue={row.severity} label={row.severity.charAt(0).toUpperCase() + row.severity.slice(1)} /></td>
                    {row.statuses.map((status, index) => (
                      <td key={index} className="filled-cell">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${status.toLowerCase() === "fixed" ? "bg-[#dcf3e1] text-green-800" : status === "—" ? "bg-band text-muted" : "bg-[#ffe4e4] text-[#b42318]"}`}>{status}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    if (b.type === "envelope") {
      return (
        <div key={`env${key}`} className="border-l-2 border-xlsx-band bg-tint-b/70 px-3 py-2">
          <dl className="space-y-0.5">
            {b.pairs.map(([label, value], j) => {
              // Anchor the "Sent:"/"Date:" row on the date it carries, so a
              // rail date that exists only inside a quoted chain can land on
              // the exact reply header.
              const dateValue = /^(sent|date)$/i.test(label) ? parseQuotedDate(value) : null;
              const recipients = ADDRESS_LABEL.test(label) ? parseRecipients(value) : [];
              return (
                <div
                  key={j}
                  data-anchor={dateValue ? `qd-${dayKeyOf(dateValue)}` : undefined}
                  className="flex gap-2"
                >
                  <dt className="w-[4.5rem] shrink-0 pt-[1px] text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="min-w-0 flex-1 break-words text-[12px] leading-snug text-ink-2">
                    {ADDRESS_LABEL.test(label) ? (
                      recipients.length ? (
                        <RecipientList recipients={recipients} showEmails={label.toLowerCase() === "from"} />
                      ) : (
                        <span className="text-muted">—</span>
                      )
                    ) : (
                      <span className="whitespace-pre-wrap">{cleanMailto(value) || "—"}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      );
    }
    return (
      <div key={`t${key}`}>
        {b.text.split(/\n/).map((line, j) => {
          if (line.trim() === "") return <div key={j} className="h-2" />;
          const cleaned = cleanBodyText(line);
          // Outlook writes horizontal rules as a run of underscores/dashes.
          if (/^[-_]{5,}$/.test(cleaned.trim())) return <hr key={j} className="my-2 border-0 border-t border-stroke" />;
          const bullet = /^[-–•]\s+/.exec(cleaned);
          const numbered = /^\d+[.)]\s+/.exec(cleaned);
          if (bullet || numbered) {
            return (
              <p key={j} className="whitespace-pre-wrap pl-4">
                {cleaned}
              </p>
            );
          }
          return (
            <p key={j} className="whitespace-pre-wrap">
              {cleaned}
            </p>
          );
        })}
      </div>
    );
  });
}

const toggleClass =
  "mt-1 inline-flex items-center gap-1 border border-stroke bg-tint-b px-2 py-1 text-[11px] font-medium text-ink-2 transition hover:bg-xlsx-data";

function NeatTextBody({ body, messageId }: { body: string; messageId?: number }) {
  const [showQuoted, setShowQuoted] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const blocks = React.useMemo(() => parseNeatBlocks(body), [body]);

  // A rail date that exists only inside quoted mail can't scroll anywhere new
  // (all such dates share the containing bubble), so it asks that bubble to
  // open its folded chain instead. Event-based so the reader's toggle state
  // stays local to this component.
  React.useEffect(() => {
    if (messageId === undefined) return;
    const onExpand = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: number }>).detail;
      if (detail?.messageId === messageId) setShowQuoted(true);
    };
    window.addEventListener("tm:expand-quote", onExpand as EventListener);
    return () => window.removeEventListener("tm:expand-quote", onExpand as EventListener);
  }, [messageId]);

  // Outlook reply chains end up as one giant raw body. Everything from the
  // first forwarded-header block onward is earlier mail — fold it away so the
  // reader sees the actual new message first (and can expand on demand).
  const firstEnvelope = blocks.findIndex((b) => b.type === "envelope");
  const splitAt = firstEnvelope > 0 ? firstEnvelope : -1;
  const head = splitAt > 0 ? blocks.slice(0, splitAt) : blocks;
  const quoted = splitAt > 0 ? blocks.slice(splitAt) : [];
  const blockChars = (b: NeatBlock) =>
    b.type === "text"
      ? b.text.length
      : b.type === "envelope"
        ? b.pairs.reduce((s, [, v]) => s + v.length, 0)
        : b.rows.reduce((s, row) => s + row.title.length + row.severity.length + row.statuses.join(" ").length + String(row.no).length, 0);
  const quotedChars = quoted.reduce((n, b) => n + blockChars(b), 0);
  const headChars = head.reduce((n, b) => n + blockChars(b), 0);
  const longHead = headChars > 2_500;

  return (
    <div className="mt-2 min-w-0 space-y-2 break-words text-[14px] leading-7 text-ink-2 [overflow-wrap:anywhere]">
      <div className={cn(longHead && !showAll && "max-h-72 overflow-hidden")}>{renderNeatBlocks(head)}</div>

      {quoted.length > 0 && quotedChars > 200 ? (
        <>
          <button type="button" onClick={() => setShowQuoted((v) => !v)} className={toggleClass}>
            {showQuoted
              ? "Hide earlier mail in this thread"
              : `Show earlier mail in this thread (${quotedChars.toLocaleString("en-GB")} characters)`}
          </button>
          {showQuoted ? (
            <div className="space-y-2 border-l-2 border-stroke pl-3 opacity-90">{renderNeatBlocks(quoted, splitAt)}</div>
          ) : null}
        </>
      ) : null}

      {longHead ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} className={toggleClass}>
          {showAll ? "Show less" : "Show full message"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * MessageBody — one readable renderer for both HTML and text mail. Long
 * Outlook chains are clamped; "Show full email" expands them in place.
 *
 * HTML Outlook replies carry the entire quoted chain inline. Without folding,
 * an earlier message appears to live inside a later bubble (e.g. a 21 Oct
 * quote inside a 22 Oct reply, duplicating the standalone 21 Oct message).
 * So the first <blockquote> onward is treated as "earlier mail in this
 * thread" and collapsed behind the same toggle as text bodies.
 */
function splitHtmlQuote(html: string): { head: string; quoted: string | null } {
  const m = /<blockquote[\s>]/i.exec(html);
  if (!m || m.index === undefined) return { head: html, quoted: null };
  return { head: html.slice(0, m.index), quoted: html.slice(m.index) };
}

function MessageBody({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = React.useState(false);
  const htmlParts = React.useMemo(
    () =>
      message.bodyHtmlSanitized
        ? splitHtmlQuote(message.bodyHtmlSanitized)
        : { head: "", quoted: null as string | null },
    [message.bodyHtmlSanitized],
  );

  // Rail dates that live inside an HTML body ask the bubble to open so the
  // click always has a visible effect (text bodies fold via NeatTextBody).
  React.useEffect(() => {
    const onExpand = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: number }>).detail;
      if (detail?.messageId === message.id) setExpanded(true);
    };
    window.addEventListener("tm:expand-quote", onExpand as EventListener);
    return () => window.removeEventListener("tm:expand-quote", onExpand as EventListener);
  }, [message.id]);

  if (message.bodyHtmlSanitized) {
    const plain = message.bodyHtmlSanitized.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const long = plain.length > 1_500;
    const headHtml = htmlParts.head;
    return (
      <div className="mt-2 min-w-0">
        <div
          className={cn(
            "message-html prose prose-sm max-w-none break-words text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere] [&_img]:max-w-full [&_pre]:whitespace-pre-wrap [&_table]:min-w-full",
            !expanded && long && "max-h-[420px] overflow-hidden",
          )}
          dangerouslySetInnerHTML={{ __html: headHtml }}
        />
        {htmlParts.quoted ? (
          <>
            <button type="button" onClick={() => setExpanded((v) => !v)} className={toggleClass}>
              {expanded
                ? "Hide earlier mail in this thread"
                : `Show earlier mail in this thread (${htmlParts.quoted.length.toLocaleString("en-GB")} characters)`}
            </button>
            {expanded ? (
              <div
                className="message-html prose prose-sm max-w-none break-words border-l-2 border-stroke pl-3 text-[13px] leading-relaxed text-ink-2 opacity-90 [overflow-wrap:anywhere] [&_img]:max-w-full [&_pre]:whitespace-pre-wrap [&_table]:min-w-full"
                dangerouslySetInnerHTML={{ __html: htmlParts.quoted }}
              />
            ) : null}
          </>
        ) : long ? (
          <button type="button" onClick={() => setExpanded((v) => !v)} className={toggleClass}>
            {expanded ? "Show less" : "Show full email"}
          </button>
        ) : null}
      </div>
    );
  }

  if (message.bodyText) return <NeatTextBody body={message.bodyText} messageId={message.id} />;
  return <p className="mt-1 text-[12px] italic text-muted">empty body</p>;
}

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: CALENDAR_TZ }) : "");

const QUOTED_DATE_LINE = /^(?:Sent|Date):\s*(.+)$/gim;
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

/** Tolerant parser for Outlook date headers ("01 September 2026 10:21",
 *  "Tuesday, September 1, 2026 12:45 PM", ISO, …). Returns null if unreadable. */
function parseQuotedDate(raw: string): Date | null {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  const direct = new Date(cleaned);
  if (!Number.isNaN(direct.getTime())) return direct;
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(cleaned);
  if (!m) return null;
  const month = MONTHS[(m[2] ?? "").toLowerCase()];
  if (month === undefined) return null;
  const d = new Date(Number(m[3]), month, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

interface DayEntry {
  key: string;
  label: string;
  count: number;
  anchor: string;
  quotedAnchor?: string;
}

interface MessageGroupData {
  key: string;
  dayKey: string;
  dayLabel: string;
  sender: ChatMessage["from"];
  role: string;
  messages: ChatMessage[];
}

function MessageGroupCard({ group, showDay }: { group: MessageGroupData; showDay: boolean }) {
  const meta = roleMeta(group.role);
  return (
    <>
      {showDay ? (
        <div id={`day-${group.dayKey}`} data-anchor={`day-${group.dayKey}`} className="flex justify-center" style={{ contentVisibility: "auto" }}>
          <span className="rounded-full border border-stroke-soft bg-card/90 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted shadow-sm">
            {group.dayLabel}
          </span>
        </div>
      ) : null}
      <section
        className="overflow-hidden rounded-[20px] border border-stroke-soft bg-card shadow-sm"
        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 220px" }}
      >
        <header className="flex items-center gap-3 border-b border-stroke-soft bg-gradient-to-r from-accent-soft/70 via-card to-[#f6edff]/70 px-4 py-3 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-2 ring-white shadow-sm" style={{ background: meta.dot }} aria-hidden>
            {initials(group.sender.displayName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[14px] font-bold text-ink">{tidyName(group.sender.displayName)}</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide ${meta.badge}`}>{meta.label}</span>
              {group.sender.roleSource === "RULE" ? <span className="text-[10px] text-muted">auto-detected</span> : null}
              {group.sender.roleSource === "HUMAN" ? <span className="text-[10px] text-muted">human-set</span> : null}
            </div>
            <p className="truncate text-[11px] text-muted">{group.sender.email}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[12px] font-semibold text-ink-2">{group.dayLabel}</p>
            <p className="text-[11px] text-muted">{group.messages.length} message{group.messages.length === 1 ? "" : "s"}</p>
          </div>
        </header>
        <div className="divide-y divide-stroke-soft">
          {group.messages.map((message) => (
            <article key={message.id} id={`msg-${message.id}`} data-anchor={`msg-${message.id}`} className="px-4 py-4 sm:px-6">
              <MessageBody message={message} />
              {message.attachments.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {message.attachments.map((attachment) => (
                    <li key={attachment.id} className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] text-ink-2 shadow-sm">
                      <Paperclip className="h-3 w-3" aria-hidden /> {attachment.filename} ({Math.max(1, Math.round((attachment.sizeBytes ?? 0) / 1024))} KB)
                    </li>
                  ))}
                </ul>
              ) : null}
              <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
                <span>To: {message.recipients.filter((r) => r.kind === "TO").map((r) => r.email).join(", ") || "—"}</span>
                <time dateTime={message.sentAt ?? undefined} title={`${message.from.email} · id ${message.messageId}`}>
                  {timeOf(message.sentAt)}{message.sentAt ? ` · ${new Date(message.sentAt).toLocaleDateString("en-GB", { timeZone: CALENDAR_TZ })}` : ""}
                </time>
              </footer>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

/**
 * All tracker mail is IST. Calendar-day grouping is pinned to Asia/Kolkata so
 * a message's day tile always matches the date written in the mail itself,
 * regardless of the viewer's machine timezone: a 21 Oct 19:00 UTC mail is
 * 22 Oct IST and must sit under 22 Oct, not under whatever day toDateString()
 * happens to produce in the browser's local zone.
 */
const CALENDAR_TZ = "Asia/Kolkata";

function dayKeyOf(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: CALENDAR_TZ });
}

function dayLabelOf(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: CALENDAR_TZ });
}

/** Drop duplicate rows for the same mail (Message-ID) so one message never renders on two day tiles. */
function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    const key = m.messageId || `row:${m.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ChatThread({ subject, appDisplayName, messages }: { subject: string; appDisplayName: string | null; messages: ChatMessage[] }) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const uniqueMessages = React.useMemo(() => dedupeMessages(messages), [messages]);
  // Jump rail data: per-day anchors. Includes dates of actual messages PLUS
  // the dates inside quoted reply headers — a single archived .eml often
  // contains a whole chain, and those dates must be jumpable too.
  const days = React.useMemo(() => {
    const map = new Map<string, DayEntry>();
    const labelOf = dayLabelOf;

    for (const m of uniqueMessages) {
      if (!m.sentAt) continue;
      const d = new Date(m.sentAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKeyOf(d);
      const prev = map.get(key);
      map.set(key, { key, label: labelOf(d), count: (prev?.count ?? 0) + 1, anchor: prev?.anchor ?? `msg-${m.id}` });
    }

    for (const m of uniqueMessages) {
      const body = m.bodyText ?? "";
      if (!body) continue;
      for (const match of body.matchAll(QUOTED_DATE_LINE)) {
        const d = parseQuotedDate(match[1] ?? "");
        if (!d) continue;
        const key = dayKeyOf(d);
        if (!map.has(key)) {
          map.set(key, { key, label: labelOf(d), count: 0, anchor: `msg-${m.id}`, quotedAnchor: `qd-${key}` });
        }
      }
    }

    return [...map.values()].sort((a, b) => new Date(a.key).getTime() - new Date(b.key).getTime());
  }, [uniqueMessages]);

  // Group all messages by calendar date and sender. Each sender/date
  // combination gets one consistent card, even when another participant
  // replied between that sender's messages; this prevents different people
  // or dates from being mixed into the same conversation box.
  const groupedMessages = React.useMemo<MessageGroupData[]>(() => {
    const groups: MessageGroupData[] = [];
    const groupByKey = new Map<string, MessageGroupData>();
    for (const message of uniqueMessages) {
      const date = message.sentAt ? new Date(message.sentAt) : null;
      const dayKey = date && !Number.isNaN(date.getTime()) ? dayKeyOf(date) : "undated";
      const dayLabel = date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: CALENDAR_TZ })
        : "Undated";
      const senderKey = message.from.email.toLowerCase();
      const key = `${dayKey}|${senderKey}`;
      let group = groupByKey.get(key);
      if (!group) {
        group = { key, dayKey, dayLabel, sender: message.from, role: message.from.effectiveRole, messages: [] };
        groupByKey.set(key, group);
        groups.push(group);
      }
      group.messages.push(message);
    }
    return groups;
  }, [messages]);

  // Role counts are used only as a thread overview; the conversation itself
  // is grouped by date and sender rather than rendered as two chat sides.
  const sideCounts = React.useMemo(() => {
    let left = 0;
    let right = 0;
    for (const m of uniqueMessages) {
      if (roleMeta(m.from.effectiveRole).side === "right") right += 1;
      else left += 1;
    }
    return { left, right };
  }, [uniqueMessages]);

  // Scroll the chat canvas itself — never the page. Rect maths (not offsetTop)
  // because offsetTop is relative to a page-level offsetParent, which sent the
  // old formula to the top of the thread. Two passes absorb height estimates
  // from `content-visibility` before the target settles.
  function jumpTo(id: string, fallbackId?: string) {
    const container = scrollRef.current;
    if (!container) return;
    const align = () => {
      const el = (container.querySelector(`[data-anchor="${id}"]`) ??
        (fallbackId ? container.querySelector(`[data-anchor="${fallbackId}"]`) : null)) as HTMLElement | null;
      if (!el) return;
      const top =
        el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 8;
      container.scrollTop = Math.max(0, top);
    };
    align();
    requestAnimationFrame(() => {
      align();
      requestAnimationFrame(align);
    });
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header with the side-split confirmation */}
      <div className="border-b border-stroke-soft px-5 pb-4 pt-2 sm:px-7">
        <h3 className="font-display truncate text-[26px] font-bold leading-tight text-ink">{subject}</h3>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted" data-testid="side-split">
          <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent-deep">
            {appDisplayName ?? "Unassigned"} · {uniqueMessages.length} messages · grouped by date and sender
          </span>
          <span className="rounded-full bg-[#f6edff] px-2.5 py-1">
            <span className="font-semibold text-sev-critical">pentester/defense: {sideCounts.left}</span>
            <span className="mx-1 text-muted">·</span>
            <span className="font-semibold text-sev-info">developer: {sideCounts.right}</span>
            <span className="ml-1">messages</span>
          </span>
        </p>
      </div>

      {/* Chat area — fixed-height canvas; the bubble list scrolls inside it.
          NOTE: no flex-1 here on purpose — in an auto-height column a
          flex-basis of 0 makes the row grow with the content and the height
          clamp is ignored (that is what made "jump to date" a no-op). */}
      <div className="flex min-h-[560px] min-w-0 flex-col gap-4 overflow-hidden px-5 py-5 sm:px-7" style={{ height: "clamp(560px, 74vh, 820px)" }}>
        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* Chat canvas — bubbles scroll inside this box. */}
        <div ref={scrollRef} className="h-full min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl bg-[linear-gradient(180deg,#fffaf6_0%,#ffffff_100%)] p-5 sm:p-7" style={{ scrollBehavior: "auto" }}>
        {groupedMessages.map((group, groupIndex) => (
          <MessageGroupCard
            key={group.key}
            group={group}
            showDay={group.dayKey !== groupedMessages[groupIndex - 1]?.dayKey}
          />
        ))}
        </div>

        {/* Jump rail — click a date or a message to jump; the human-machine
            shortcut for long vendor threads. Also lists every UPLOADED .eml
            in confirmation order (1..N, user direction). */}
        <aside className="hidden w-52 shrink-0 flex-col border-l border-stroke pl-3 xl:flex" aria-label="Conversation jump rail">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Jump to date</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => {
                  // Quoted-only dates all live in the same bubble; open its
                  // folded chain so the click has a visible effect.
                  if (d.count === 0) {
                    const messageId = Number(d.anchor.replace("msg-", ""));
                    if (Number.isFinite(messageId)) {
                      window.dispatchEvent(new CustomEvent("tm:expand-quote", { detail: { messageId } }));
                    }
                  }
                  jumpTo(d.quotedAnchor ?? d.anchor, d.quotedAnchor ? d.anchor : undefined);
                }}
                title={
                  d.count > 0
                    ? `Jump to ${d.label} (${d.count} message${d.count === 1 ? "" : "s"})`
                    : `Jump to mail dated ${d.label} (quoted inside this thread)`
                }
                className="flex items-center gap-1 border border-stroke bg-card px-2 py-1 text-[11px] font-medium text-ink-2 transition hover:bg-xlsx-data"
              >
                {d.label}
                {d.count > 0 ? <span className="text-[10px] text-muted">{d.count}</span> : null}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted">Uploaded .eml files (in order)</p>
          <div className="mt-1 max-h-44 flex-1 overflow-y-auto pr-1">
            <ol className="space-y-1">
              {uniqueMessages.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(`msg-${m.id}`)}
                    className="w-full truncate border bg-tint-b px-2 py-1 text-left text-[11px] text-ink-2 transition hover:bg-xlsx-data"
                    title={`Jump to message ${i + 1}${m.uploadedFile ? ` · ${m.uploadedFile}` : ""}`}
                  >
                    <span className="font-semibold text-ink">{i + 1}.</span> {m.uploadedFile ?? `(stored) ${m.sourceFile ?? "—"}`}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted">Jump to message</p>
          <div className="mt-1 flex-1 overflow-y-auto pr-1" style={{ maxHeight: 320 }}>
            <ul className="space-y-1">
              {uniqueMessages.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(`msg-${m.id}`)}
                    className="w-full truncate border border-stroke bg-card px-2 py-1 text-left text-[11px] text-ink-2 transition hover:bg-xlsx-data"
                    title={`${tidyName(m.from.displayName)} — ${m.sentAt ? new Date(m.sentAt).toLocaleString("en-GB", { timeZone: CALENDAR_TZ }) : "no date"}`}
                  >
                    <span className="font-semibold">{i + 1}.</span>{" "}
                    <span className={roleMeta(m.from.effectiveRole).side === "right" ? "text-sev-info" : "text-sev-critical"}>
                      {tidyName(m.from.displayName)}
                    </span>
                    {" — "}
                    {timeOf(m.sentAt)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        </div>
      </div>

      {/* Composer is intentionally absent: no mailbox/SMTP integration by design —
          the typed record lives in audited actions, not ad-hoc emails. */}
      <p className="mt-2 text-[11px] text-muted">
        Read-only chat reconstruction from uploaded .eml files — originals are preserved verbatim (sha256). Follow-up requests happen through audited
        actions, not ad-hoc mail.
      </p>
    </div>
  );
}

export { Input, AtSign };
