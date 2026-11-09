"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, FileInput, Loader2, Square } from "lucide-react";

function csrf(): string | null {
  const raw = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

interface PstSubject {
  key: string;
  subject: string;
  count: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
  senders: string[];
  vaptFlagged: boolean;
}

interface PstConfirmResult {
  imported: number;
  skipped: number;
  threads: number[];
  warnings: string[];
}

/**
 * .pst ingestion (user-directed alternative to .eml): upload → subject-line
 * filter (VAPT-flagged pre-ticked) → confirm-selected → SAME .eml pipeline.
 */
export function PstImportButton({ applicationId }: { applicationId: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [stage, setStage] = React.useState<"idle" | "parsed">("idle");
  const [jobId, setJobId] = React.useState<number | null>(null);
  const [subjects, setSubjects] = React.useState<PstSubject[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<PstConfirmResult | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/emails/pst/upload", {
        method: "POST",
        headers: { ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Upload failed.");
        return;
      }
      setJobId(data.result.jobId);
      const parsed = await fetch(`/api/emails/pst/${data.result.jobId}/parse`, {
        method: "POST",
        headers: { ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
      });
      const pData = await parsed.json().catch(() => null);
      if (!parsed.ok) {
        setError(pData?.error?.message ?? "Parsing failed.");
        return;
      }
      setSubjects((pData.result.subjects ?? []) as PstSubject[]);
      const pre = new Set<string>((pData.result.subjects ?? []).filter((s: PstSubject) => s.vaptFlagged).map((s: PstSubject) => s.key));
      setSelected(pre);
      setStage("parsed");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirmSelection(keys: string[]) {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const declared = applicationId && applicationId > 0 ? Number(applicationId) : undefined;
      const res = await fetch(`/api/emails/pst/${jobId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: JSON.stringify({ selectedKeys: keys, declaredApplicationId: declared }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Confirm failed.");
        return;
      }
      setDone(data.result as PstConfirmResult);
      setStage("idle");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2 border border-stroke bg-xlsx-band px-3 py-2 text-[13px] font-semibold text-ink-2 transition hover:bg-xlsx-data">
        {busy && stage === "idle" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileInput className="h-4 w-4" aria-hidden />}
        Import .pst (Outlook archive)
        <input
          ref={fileRef}
          type="file"
          accept=".pst"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
      {busy && stage !== "idle" ? <span className="inline-flex items-center gap-2 text-[12px] text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Working…</span> : null}
      {error ? <span role="alert" className="text-[12px] text-danger">{error}</span> : null}
      {done ? (
        <span className="text-[12px] text-ink-2">
          Imported {done.imported} messages into {done.threads.length} thread(s) · skipped {done.skipped}
          {done.warnings.length ? ` · warnings ${done.warnings.length}` : ""}
        </span>
      ) : null}

      {stage === "parsed" && subjects.length ? (
        <div className="mt-3 panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink">Subject lines in the .pst ({subjects.length} threads)</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="border border-stroke bg-card px-2 py-1 text-[11px] text-ink-2"
                onClick={() => setSelected(new Set(subjects.map((s) => s.key)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="border border-stroke bg-card px-2 py-1 text-[11px] text-ink-2"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="mt-2 max-h-[320px] overflow-y-auto border border-stroke bg-card">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-stroke bg-xlsx-band/70">
                  <th className="w-8 px-2 py-1 text-left"> </th>
                  <th className="px-2 py-1 text-left font-semibold text-ink">Subject</th>
                  <th className="px-2 py-1 text-left font-semibold text-ink">Msgs</th>
                  <th className="px-2 py-1 text-left font-semibold text-ink">Date range</th>
                  <th className="px-2 py-1 text-left font-semibold text-ink">Flag</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  <tr key={s.key} className="border-b border-stroke-soft last:border-0">
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(selected);
                          if (next.has(s.key)) next.delete(s.key);
                          else next.add(s.key);
                          setSelected(next);
                        }}
                        aria-pressed={selected.has(s.key)}
                      >
                        {selected.has(s.key) ? <CheckSquare className="h-4 w-4 text-good" aria-hidden /> : <Square className="h-4 w-4 text-muted" aria-hidden />}
                      </button>
                    </td>
                    <td className="max-w-[420px] truncate px-2 py-1 text-ink-2" title={s.subject}>
                      {s.subject}
                    </td>
                    <td className="px-2 py-1 tabular-nums">{s.count}</td>
                    <td className="px-2 py-1 text-muted">
                      {s.firstSentAt ? new Date(s.firstSentAt).toLocaleDateString("en-GB") : "—"} → {s.lastSentAt ? new Date(s.lastSentAt).toLocaleDateString("en-GB") : "—"}
                    </td>
                    <td className="px-2 py-1">
                      {s.vaptFlagged ? <span className="bg-sev-critical-soft px-1.5 py-0.5 text-[10px] font-bold text-sev-critical-text">VAPT</span> : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => confirmSelection([...selected])}
              className="inline-flex items-center gap-2 bg-sev-low px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              <CheckSquare className="h-4 w-4" aria-hidden />
              Import {selected.size} selected subject(s)
            </button>
            <button type="button" className="border border-stroke bg-card px-3 py-1.5 text-[13px] text-ink-2" onClick={() => setStage("idle")} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
