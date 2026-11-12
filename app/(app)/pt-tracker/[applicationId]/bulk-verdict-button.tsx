"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";

function csrf(): string | null {
  const raw = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: "not_fixed", label: "Not Fixed" },
  { value: "open", label: "Open" },
  { value: "not_retested", label: "Not Retested" },
  { value: "accepted_risk", label: "Accepted Risk (CAR)" },
  { value: "out_of_scope", label: "Out of Scope" },
  { value: "removed", label: "Removed" },
];

/**
 * One-click human verdict for the WHOLE findings table (universal fix
 * 2026-11): records the same status on every active finding for one
 * iteration. Backend is strictly human-gated (source HUMAN) and skips
 * findings already carrying that exact status — no duplicate history.
 */
export function BulkVerdictButton({ applicationId, iterations }: { applicationId: number; iterations: { number: number }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState("fixed");
  const [iterationNumber, setIterationNumber] = React.useState(iterations[iterations.length - 1]?.number ?? 2);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/findings/bulk-verdict`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: JSON.stringify({ iterationNumber, statusValue: status, ...(note.trim() ? { retestNote: note.trim() } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Bulk verdict failed.");
        return;
      }
      const r = data.result as { applied: number; unchanged: number; failed: { code: string }[]; total: number };
      setMsg(`Recorded "${STATUS_OPTIONS.find((s) => s.value === status)?.label}" on ${r.applied} finding(s) for Iteration ${iterationNumber} · ${r.unchanged} already had it${r.failed.length ? ` · ${r.failed.length} failed` : ""}.`);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (iterations.length === 0) return null;
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 border border-stroke bg-card px-3 py-2 text-[13px] text-ink-2 transition hover:bg-xlsx-data"
          aria-expanded={open}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCheck className="h-4 w-4" aria-hidden />}
          Record verdict for all findings
        </button>
        {open ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stroke bg-card px-3 py-2">
            <label className="text-[12px] text-muted">
              Iteration
              <select
                value={iterationNumber}
                onChange={(e) => setIterationNumber(Number(e.target.value))}
                className="ml-2 rounded border border-stroke bg-page px-2 py-1 text-[13px] text-ink"
              >
                {iterations.filter((i) => i.number <= 2).map((i) => (
                  <option key={i.number} value={i.number}>Iteration {i.number}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-muted">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="ml-2 rounded border border-stroke bg-page px-2 py-1 text-[13px] text-ink"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional, stored on every changed finding)"
              className="w-64 rounded border border-stroke bg-page px-2 py-1 text-[13px] text-ink"
            />
            <button
              type="button"
              onClick={apply}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-accent-deep disabled:opacity-60"
            >
              Apply to all
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      {msg ? <span className="text-[12px] text-green-700">{msg}</span> : null}
      {error ? <span className="text-[12px] text-red-700">{error}</span> : null}
    </div>
  );
}
