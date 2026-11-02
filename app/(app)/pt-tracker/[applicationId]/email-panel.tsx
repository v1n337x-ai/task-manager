"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AtSign, FilePlus2, Paperclip, Check, TriangleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AiReview } from "./ai-review-panel";

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
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Upload .EML files</h3>
          <Badge variant="muted">drag &amp; drop or picker · .eml only</Badge>
        </div>
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
  from: { email: string; displayName: string; effectiveRole: string; roleSource?: string | null; confidence?: number | null };
  recipients: { kind: string; email: string; name: string | null }[];
  attachments: { id: number; filename: string; sizeBytes: number | null }[];
}

const ROLE_META: Record<string, { label: string; badge: string; dot: string; side: "left" | "right" }> = {
  pentester: { label: "PENTESTER", badge: "bg-accent/10 text-accent-deep", dot: "#E86B10", side: "left" },
  developer: { label: "DEVELOPER", badge: "bg-progress/10 text-progress", dot: "#2E86C1", side: "right" },
  application_owner: { label: "APP OWNER", badge: "bg-tint-a text-ink-2", dot: "#5D4A78", side: "right" },
  security_team: { label: "SECURITY", badge: "bg-tint-a text-ink-2", dot: "#2E862E", side: "left" },
  unknown: { label: "ROLE UNKNOWN", badge: "bg-band text-muted", dot: "#9E9E9E", side: "left" },
};

function roleMeta(effectiveRole: string) {
  const key = effectiveRole.replace(/\s*\(human override\)\s*/i, "").trim();
  if (effectiveRole.includes("human")) return { label: `HUMAN · ${key.toUpperCase()}`, badge: "bg-good/10 text-good", dot: "#2E862E", side: key.includes("pentester") ? "left" : "right" } as const;
  return ROLE_META[key] ?? { label: key.toUpperCase(), badge: "bg-band text-ink-2 border border-stroke", dot: "#9E9E9E", side: "left" } as const;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

function ChatThread({ subject, appDisplayName, messages }: { subject: string; appDisplayName: string | null; messages: ChatMessage[] }) {
  return (
    <div className="flex h-full flex-col">
      {/* Chat header — sticky within the panel */}
      <div className="border-b border-stroke pb-3">
        <h3 className="font-display truncate text-2xl text-ink">{subject}</h3>
        <p className="text-[12px] text-muted">
          {appDisplayName ?? "Unassigned"} · {messages.length} messages · original .eml files preserved verbatim
        </p>
      </div>

      {/* Chat area — bubbles scroll inside a fixed-height canvas */}
      <div className="mt-3 min-h-[420px] flex-1 space-y-3 overflow-y-auto rounded-xl bg-tint-b p-4" style={{ maxHeight: 640 }}>
        {messages.map((m, i) => {
          const meta = roleMeta(m.from.effectiveRole);
          const side = meta.side;
          const isRight = side === "right";
          const mine = i > 0 && messages[i - 1]!.from.email === m.from.email;
          const dayKey = m.sentAt ? new Date(m.sentAt).toDateString() : "";
          const prevSent = i > 0 ? messages[i - 1]!.sentAt : null;
          const prevDay = prevSent ? new Date(prevSent).toDateString() : "";
          return (
            <React.Fragment key={m.id}>
              {dayKey && dayKey !== prevDay ? (
                <div className="flex justify-center">
                  <span className="rounded-none bg-card px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted shadow-sm">
                    {m.sentAt ? new Date(m.sentAt).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short" }) : "undated message"}
                  </span>
                </div>
              ) : null}
              <div className={`flex gap-2 ${isRight ? "flex-row-reverse" : ""}`}>
                {/* Avatar */}
                <span
                  className={`mt-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm sm:flex ${mine ? "" : ""}`}
                  style={{ background: meta.dot }}
                  aria-hidden
                >
                  {initials(m.from.displayName)}
                </span>

                {/* Bubble */}
                <div className={`flex max-w-[78%] flex-col ${isRight ? "items-end" : "items-start"}`}>
                  <div
                    className={`w-full rounded-2xl border px-3.5 py-2.5 shadow-sm ${
                      isRight ? "border-accent/25 bg-accent-soft" : "border-stroke bg-card"
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
                      <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{m.bodyText}</p>
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
