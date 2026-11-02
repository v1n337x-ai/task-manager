"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AtSign, FilePlus2, Paperclip, Check, TriangleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
  const [activeThread, setActiveThread] = React.useState<ThreadSummary | null>(threads[0] ?? null);
  const [threadDetail, setThreadDetail] = React.useState<ThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [pstOpen, setPstOpen] = React.useState(false);

  async function upload() {
    if (files.length === 0) return;
    setBusy(true);
    setLast(null);
    try {
      const fd = new FormData();
      fd.set("applicationId", String(applicationId));
      for (const f of files) fd.append("files", f);
      const res = await fetch("/api/emails/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setLast(data.error?.message ?? "Upload failed.");
        setResults(null);
        return;
      }
      setResults(data.results as UploadPreviewItem[]);
      setPhase("previewed");
    } finally {
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
    setActiveThread(thread);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/emails/threads/${thread.id}`);
      const data = await res.json();
      setThreadDetail(res.ok ? (data as ThreadDetail) : null);
    } finally {
      setDetailLoading(false);
    }
  }

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
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <AtSign className="h-4 w-4" aria-hidden />} Parse
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

      <section aria-label="Conversation threads" className="grid gap-5 lg:grid-cols-[minmax(240px,340px)_1fr]">
        <div className="panel px-3 py-3">
          <h3 className="px-2 text-[13px] font-semibold uppercase tracking-wide text-ink">Threads</h3>
          {threads.length === 0 ? (
            <p className="px-2 py-4 text-[13px] text-muted">No threads linked to this application yet.</p>
          ) : (
            <ul>
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => openThread(t)}
                    className={cn(
                      "w-full rounded-md px-2 py-2 text-left text-[13px] transition",
                      activeThread?.id === t.id ? "bg-band font-semibold text-ink" : "text-ink-2 hover:bg-band",
                    )}
                  >
                    <span className="block truncate">{t.subject}</span>
                    <span className="block text-[11px] text-muted">
                      {t.messageCount} message(s) · last {t.lastSentAt ? new Date(t.lastSentAt).toLocaleDateString("en-GB") : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel px-5 py-4">
          {detailLoading ? (
            <p className="text-[13px] text-muted">Loading conversation…</p>
          ) : !threadDetail ? (
            <p className="text-[13px] text-muted">Select a thread to read the reconstructed conversation.</p>
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

/** Two-sided thread convention: LEFT = Akasa defense + pentester (assessment
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
const HEADER_LINE = /^(from|sent|to|cc|bcc|subject|date|importance|attachments)\s*:\s*(.*)$/i;

type NeatBlock = { type: "envelope"; pairs: [string, string][] } | { type: "text"; text: string };

function parseNeatBlocks(body: string): NeatBlock[] {
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

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
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
      // Continuation of the last header (Outlook wraps long values) or blank end.
      if (line.trim() === "") {
        if (envelope.length > 0) envelope = null;
        continue;
      }
      
      // Values wrap; keep absorbing until a blank line.
      const last = envelope[envelope.length - 1];
      if (last) last[1] = `${last[1]} ${line.trim()}`.trim();
      continue;
    }
    textBuf.push(line.replace(/^\s*>\s?/, ""));
  }
  pushText();
  return blocks;
}

function NeatTextBody({ body }: { body: string }) {
  const blocks = parseNeatBlocks(body);
  return (
    <div className="mt-1.5 space-y-2 text-[13px] leading-relaxed text-ink-2">
      {blocks.map((b, i) => {
        if (b.type === "envelope") {
          return (
            <div key={`env${i}`} className="border-l-2 border-xlsx-band bg-tint-b/70 px-3 py-2">
              <dl className="space-y-0.5">
                {b.pairs.map(([label, value], j) => (
                  <div key={j} className="flex gap-2">
                    <dt className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
                    <dd className="min-w-0 break-words text-[12px] text-ink-2">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        }
        return (
          <div key={`t${i}`}>
            {b.text.split(/\n/).map((line, j) => {
              if (line.trim() === "") return <div key={j} className="h-2" />;
              const bullet = /^[-–•]\s+/.exec(line);
              const numbered = /^\d+[.)]\s+/.exec(line);
              if (bullet || numbered) {
                return (
                  <p key={j} className="whitespace-pre-wrap pl-4">
                    {line}
                  </p>
                );
              }
              return (
                <p key={j} className="whitespace-pre-wrap">
                  {line}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

function ChatThread({ subject, appDisplayName, messages }: { subject: string; appDisplayName: string | null; messages: ChatMessage[] }) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Jump rail data: per-day anchors (with message counts).
  const days = React.useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const m of messages) {
      const key = m.sentAt ? new Date(m.sentAt).toDateString() : "undated";
      const label = m.sentAt ? new Date(m.sentAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "undated";
      const prev = map.get(key);
      map.set(key, { label: prev?.label ?? label, count: (prev?.count ?? 0) + 1 });
    }
    return [...map.entries()].map(([key, v]) => ({ key, ...v }));
  }, [messages]);

  // Two-sided split computed from the resolved roles — confirms that EVERY
  // message is assigned to the pentester/defense side or the developer side.
  const sideCounts = React.useMemo(() => {
    let left = 0;
    let right = 0;
    for (const m of messages) {
      if (roleMeta(m.from.effectiveRole).side === "right") right += 1;
      else left += 1;
    }
    return { left, right };
  }, [messages]);

  function jumpTo(id: string) {
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-anchor="${id}"]`);
    if (el) container.scrollTo({ top: (el as HTMLElement).offsetTop - container.offsetTop - 8, behavior: "auto" });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with the side-split confirmation */}
      <div className="border-b border-stroke pb-3">
        <h3 className="font-display truncate text-2xl text-ink">{subject}</h3>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted" data-testid="side-split">
          <span>
            {appDisplayName ?? "Unassigned"} · {messages.length} messages
          </span>
          <span>
            <span className="font-semibold text-sev-critical">pentester/defense {sideCounts.left}</span>
            <span className="mx-1 text-muted">·</span>
            <span className="font-semibold text-sev-info">developer {sideCounts.right}</span>
            <span> every message is on a side</span>
          </span>
        </p>
      </div>

      {/* Chat area — bubbles scroll inside a fixed-height canvas; contained
          scrolling keeps the page from jumping (the delayed-scroll fix). */}
      <div className="mt-3 flex min-h-[420px] flex-1 gap-3" style={{ maxHeight: 640 }}>
        {/* Chat canvas — bubbles scroll inside; contained scrolling keeps the
            page from jumping (the delayed-scroll fix). */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain bg-tint-b p-4" style={{ scrollBehavior: "auto" }}>
        {messages.map((m, i) => {
          const meta = roleMeta(m.from.effectiveRole);
          const side = meta.side;
          const isRight = side === "right";
          const dayKey = m.sentAt ? new Date(m.sentAt).toDateString() : "";
          const prevSent = i > 0 ? messages[i - 1]!.sentAt : null;
          const prevDay = prevSent ? new Date(prevSent).toDateString() : "";
          return (
            <React.Fragment key={m.id}>
              {dayKey && dayKey !== prevDay ? (
                <div id={`day-${dayKey}`} data-anchor={`day-${dayKey}`} className="flex justify-center" style={{ contentVisibility: "auto" }}>
                  <span className="rounded-none bg-card px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted shadow-sm">
                    {m.sentAt ? new Date(m.sentAt).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" }) : "undated message"}
                  </span>
                </div>
              ) : null}
              <div id={`msg-${m.id}`} data-anchor={`msg-${m.id}`} className={`flex gap-2 ${isRight ? "flex-row-reverse" : ""}`} style={{ contentVisibility: "auto", containIntrinsicSize: "auto 220px" }}>
                {/* Avatar */}
                <span
                  className={`mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white sm:flex`}
                  style={{ background: meta.dot }}
                  aria-hidden
                >
                  {initials(m.from.displayName)}
                </span>

                {/* Bubble */}
                <div className={`flex max-w-[78%] flex-col ${isRight ? "items-end" : "items-start"}`}>
                  <div
                    className={`w-full rounded-none border px-3.5 py-2.5 shadow-sm ${
                      isRight ? "border-[#171717] bg-xlsx-peach" : "border-[#171717] bg-card"
                    }`}
                  >
                    <p className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className={`font-semibold ${isRight ? "text-ink" : "text-ink-2"}`}>{m.from.displayName}</span>
                      <span className={`inline-flex items-center rounded-none px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${meta.badge}`}>
                        {meta.label}
                      </span>
                      {m.from.roleSource === "RULE" ? <span className="text-[9px] text-muted">auto-detected</span> : null}
                      {m.from.roleSource === "HUMAN" ? <span className="text-[9px] text-muted">human-set</span> : null}
                    </p>
                    {m.bodyHtmlSanitized ? (
                      <div
                        className="prose prose-sm mt-2 max-w-none overflow-hidden text-[13px]"
                        dangerouslySetInnerHTML={{ __html: m.bodyHtmlSanitized }}
                      />
                    ) : m.bodyText ? (
                      <NeatTextBody body={m.bodyText} />
                    ) : (
                      <p className="mt-1 text-[12px] italic text-muted">empty body</p>
                    )}
                    {m.attachments.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {m.attachments.map((a) => (
                          <li key={a.id} className="flex items-center gap-1 rounded-none bg-tint-b px-2 py-0.5 text-[11px] text-ink-2">
                            <Paperclip className="h-3 w-3" aria-hidden /> {a.filename} ({Math.max(1, Math.round((a.sizeBytes ?? 0) / 1024))} KB)
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="mt-1.5 text-right text-[10px] text-muted" title={`${m.from.email} · id ${m.messageId}`}>
                      {timeOf(m.sentAt)}
                      {m.sentAt ? ` · ${new Date(m.sentAt).toLocaleDateString("en-GB")}` : ""}
                    </p>
                  </div>
                  {/* Recipients faint line under the bubble (first message of a run only) */}
                  {i === 0 || messages[i - 1]!.from.email !== m.from.email ? (
                    <p className="mt-0.5 overflow-hidden text-ellipsis text-[10px] text-muted">
                      to: {m.recipients.filter((r) => r.kind === "TO").map((r) => r.email).join(", ") || "—"}
                    </p>
                  ) : null}
                </div>
              </div>
            </React.Fragment>
          );
        })}
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
                onClick={() => jumpTo(`day-${d.key}`)}
                className="flex items-center gap-1 border border-stroke bg-card px-2 py-1 text-[11px] font-medium text-ink-2 transition hover:bg-xlsx-data"
              >
                {d.label} <span className="text-[10px] text-muted">{d.count}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted">Uploaded .eml files (in order)</p>
          <div className="mt-1 max-h-44 flex-1 overflow-y-auto pr-1">
            <ol className="space-y-1">
              {messages.map((m, i) => (
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
              {messages.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(`msg-${m.id}`)}
                    className="w-full truncate border border-stroke bg-card px-2 py-1 text-left text-[11px] text-ink-2 transition hover:bg-xlsx-data"
                    title={`${m.from.displayName} — ${m.sentAt ? new Date(m.sentAt).toLocaleString("en-GB") : "no date"}`}
                  >
                    <span className="font-semibold">{i + 1}.</span>{" "}
                    <span className={roleMeta(m.from.effectiveRole).side === "right" ? "text-sev-info" : "text-sev-critical"}>
                      {m.from.displayName}
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
