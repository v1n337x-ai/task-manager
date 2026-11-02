"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AtSign, FilePlus2, Paperclip, Check, TriangleAlert, Loader2, Replace } from "lucide-react";
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
            <div>
              <h3 className="font-display text-2xl text-ink">{threadDetail.thread.subject}</h3>
              <p className="mt-0.5 text-[12px] text-muted">
                {threadDetail.thread.application?.displayName ?? "Unassigned"} · {threadDetail.thread.messageCount} messages
              </p>
              <ol className="mt-4 space-y-5">
                {threadDetail.messages.map((m) => {
                  const role = m.from.effectiveRole;
                  const roleChip: { label: string; cls: string } =
                    role.includes("human")
                      ? { label: `${role}`, cls: "bg-tint-a text-ink-2 border border-stroke" }
                      : role === "pentester"
                        ? { label: "PENTESTER", cls: "bg-accent/10 text-accent-deep border border-accent/30" }
                        : role === "developer"
                          ? { label: "DEVELOPER", cls: "bg-progress/10 text-progress border border-progress/30" }
                          : role === "application_owner"
                            ? { label: "APP OWNER", cls: "bg-tint-a text-ink-2 border border-stroke" }
                            : role === "security_team"
                              ? { label: "SECURITY", cls: "bg-tint-a text-ink-2 border border-stroke" }
                              : role === "unknown"
                                ? { label: "ROLE UNKNOWN", cls: "bg-band text-muted border border-stroke" }
                                : { label: role.toUpperCase(), cls: "bg-band text-ink-2 border border-stroke" };
                  const detection =
                    m.from.roleSource === "RULE"
                      ? "auto-detected from the .eml"
                      : m.from.roleSource === "HUMAN"
                        ? "human-set"
                        : m.from.roleSource === "AI"
                          ? "AI-proposed"
                          : null;
                  return (
                    <li key={m.id} className="rounded-lg border border-stroke p-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
                            {m.from.displayName} <span className="text-muted">({m.from.email})</span>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${roleChip.cls}`} data-testid={`role-${role}`}>
                              {roleChip.label}
                            </span>
                            {detection ? <span className="text-[10px] font-normal text-muted">{detection}</span> : null}
                          </p>
                          <p className="text-[11px] text-muted">{m.sentAt ? new Date(m.sentAt).toLocaleString("en-GB") : "no date"}</p>
                        </div>
                        <Badge variant={m.bodyHtmlSanitized ? "info" : "muted"}>{m.bodyHtmlSanitized ? "html (sanitized)" : "text"}</Badge>
                      </div>
                    <p className="mt-1 text-[13px] text-muted-2">
                      to: {m.recipients.filter((r) => r.kind === "TO").map((r) => r.email).join(", ") || "—"}
                      {m.recipients.some((r) => r.kind === "CC") ? ` · cc: ${m.recipients.filter((r) => r.kind === "CC").map((r) => r.email).join(", ")}` : ""}
                    </p>
                    {m.bodyHtmlSanitized ? (
                      <div className="prose prose-sm mt-3 max-w-none overflow-hidden rounded-md bg-white p-3 text-[13px]" dangerouslySetInnerHTML={{ __html: m.bodyHtmlSanitized }} />
                    ) : m.bodyText ? (
                      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-tint-b p-3 text-[12px] leading-snug text-ink-2">{m.bodyText}</pre>
                    ) : (
                      <p className="mt-2 text-[12px] italic text-muted">empty body</p>
                    )}
                    {m.attachments.length > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {m.attachments.map((a) => (
                          <li key={a.id} className="flex items-center gap-1 rounded-full border border-stroke bg-band px-2 py-0.5 text-[11px] text-ink-2">
                            <Paperclip className="h-3 w-3" aria-hidden /> {a.filename} ({Math.max(1, Math.round((a.sizeBytes ?? 0) / 1024))} KB)
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="mt-2 text-[10px] text-muted">source: {m.sourceFile ?? "—"} · message-id: {m.messageId}</p>
                  </li>
                  );
                })}
              </ol>
              <Replace className="hidden" aria-hidden />
            </div>
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
  messages: {
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
  }[];
}

export { Input, AtSign };
