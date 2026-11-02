"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileUp, Loader2, Trash2 } from "lucide-react";
import type { ApplicationReportDTO } from "@/lib/services/reporting/pdf-report-service";

function csrf(): string | null {
  const raw = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/**
 * Per-application PDF reports panel (user-requested): upload the tester PDF
 * against the application (optionally pinning an iteration), list uploads,
 * download originals, superuser delete. All calls auth + CSRF enforced.
 */
export function UploadPdfPanel({
  applicationId,
  iterations,
  reports,
}: {
  applicationId: number;
  iterations: { id: number; label: string }[];
  reports: ApplicationReportDTO[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [iterationId, setIterationId] = React.useState<string>("");
  const [deleting, setDeleting] = React.useState<number | null>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      form.set("iterationId", iterationId === "" ? "" : iterationId);
      const res = await fetch(`/api/applications/${applicationId}/reports`, {
        method: "POST",
        headers: { ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Upload failed.");
        return;
      }
      (event.target as HTMLFormElement).reset();
      setIterationId("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(reportId: number) {
    if (!window.confirm("Delete this uploaded PDF permanently? This action is logged.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/app-reports/${reportId}`, {
        method: "DELETE",
        headers: { ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "Delete failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  return (
    <section className="panel px-5 py-4">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Iteration report PDFs</h2>
      <p className="mt-0.5 text-[13px] text-muted">
        Attach the tester&apos;s PDF report per iteration. Original files are stored verbatim (sha256); downloads return the exact bytes.
      </p>

      <form onSubmit={upload} className="mt-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-stroke bg-card px-3 py-2 text-[13px] text-ink-2 shadow-sm transition hover:border-accent hover:text-accent-deep">
          <FileUp className="h-4 w-4" aria-hidden />
          Choose PDF…
          <input type="file" name="file" accept="application/pdf,.pdf" required className="hidden" onChange={(e) => { e.currentTarget.setCustomValidity(""); }} />
        </label>
        <select
          value={iterationId}
          onChange={(e) => setIterationId(e.target.value)}
          aria-label="Pin to iteration (optional)"
          className="rounded-lg border border-stroke bg-card px-3 py-2 text-[13px] text-ink-2 shadow-sm focus:outline-none"
        >
          <option value="">Whole application (no iteration)</option>
          {iterations.map((it) => (
            <option key={it.id} value={it.id}>
              {it.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:opacity-55"
          data-testid="upload-pdf"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
          Upload
        </button>
        {error ? (
          <span role="alert" className="text-[12px] text-danger">
            {error}
          </span>
        ) : null}
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">File</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 whitespace-nowrap">Iteration</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 whitespace-nowrap">Size</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 whitespace-nowrap">Uploaded</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 whitespace-nowrap">By</th>
              <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[13px] text-muted">
                  No PDFs uploaded for this application yet.
                </td>
              </tr>
            ) : null}
            {reports.map((r) => (
              <tr key={r.id} className="border-t border-stroke-soft">
                <td className="max-w-[280px] truncate px-3 py-2 align-top text-ink-2" title={`${r.fileName} · sha256 ${r.sha256.slice(0, 12)}`}>
                  {r.fileName}
                </td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-ink-2">{r.iterationNumber ? `I${r.iterationNumber}` : "—"}</td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-muted">{formatBytes(r.byteSize)}</td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-muted">{new Date(r.createdAt).toLocaleString("en-GB")}</td>
                <td className="px-3 py-2 align-top whitespace-nowrap text-muted">{r.uploadedBy}</td>
                <td className="px-3 py-2 align-top whitespace-nowrap">
                  <a
                    href={`/api/app-reports/${r.id}`}
                    className="mr-2 inline-flex items-center gap-1 rounded-md border border-stroke px-2 py-1 text-[12px] text-ink-2 transition hover:bg-band"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden /> Download
                  </a>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    disabled={busy || deleting === r.id}
                    className="inline-flex items-center gap-1 rounded-md border border-stroke px-2 py-1 text-[12px] text-danger transition hover:bg-danger/5"
                  >
                    {deleting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
