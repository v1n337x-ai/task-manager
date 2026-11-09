"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, FileDown, RefreshCw, UploadCloud, Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PreviewSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warnings: number;
  willCreateApplications: number;
  willUpdateApplications: number;
  newEngagements: number;
  newIterations: number;
  snapshotsUpdated: number;
  duplicateSNo: string[];
  iterationDetected: string;
  removedTestCasesExpected: number;
  identityWarnings: number;
}

interface ExceptionItem {
  severity: "error" | "warning";
  row?: number;
  ref?: string;
  code: string;
  message: string;
}

/** Import dialog (§25-§30): upload → validation → preview → explicit confirm. */
export function ImportExcelDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [createMissing, setCreateMissing] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewSummary | null>(null);
  const [exceptions, setExceptions] = React.useState<ExceptionItem[]>([]);
  const [jobId, setJobId] = React.useState<number | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  function csrf(): string | null {
    const raw = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
    return raw ? raw.split("=").slice(1).join("=") : null;
  }

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("createMissingApplications", String(createMissing));
      const res = await fetch("/api/imports/excel", {
        method: "POST",
        body: fd,
        headers: csrf() ? { "x-csrf-token": csrf()! } : {},
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error?.message ?? "Validation failed.");
        setPreview(null);
        return;
      }
      if (data.alreadyImported) {
        setNotice("This exact file was already imported — import is idempotent. Use a modified workbook or confirm force=true from the API if you intend a re-import.");
        setPreview(data.preview ?? null);
        setJobId(null);
        return;
      }
      setPreview(data.preview);
      setExceptions(data.exceptions ?? []);
      setJobId(data.jobId ?? null);
      setNotice(data.success ? "Validation finished. Review the preview, then confirm the import." : "Validation found errors — fix the workbook, then upload again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!jobId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/imports/excel/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error?.message ?? "Import failed.");
        return;
      }
      setNotice(`Import completed: ${data.result?.rowsProcessed ?? 0} rows persisted (${data.result?.warningCount ?? 0} warnings, ${data.result?.rowsFailed ?? 0} skipped).`);
      setPreview(null);
      setJobId(null);
      setFile(null);
      router.refresh();
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="import-excel">
        <FileUp className="h-4 w-4" aria-hidden /> Import Excel
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import PT Tracker workbook</DialogTitle>
            <DialogDescription>PT Tracker v1.0 — 39-column fixed contract. Validation runs first; nothing is written until you confirm.</DialogDescription>
          </DialogHeader>

          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full rounded-lg border border-stroke bg-card px-3 py-2 text-[13px]"
            aria-label="Choose PT Tracker workbook"
          />
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
            Create applications that cannot be matched by name/alias (otherwise rows stay unresolved and are skipped)
          </label>

          <div className="flex items-center gap-2">
            <Button variant="accent" onClick={handleUpload} disabled={busy || !file}>
              <UploadCloud className="h-4 w-4" aria-hidden /> {busy ? "Validating…" : "Validate"}
            </Button>
            {jobId && preview ? (
              <Button variant="primary" onClick={() => setConfirmOpen(true)} disabled={busy}>
                <Check className="h-4 w-4" aria-hidden /> Confirm import
              </Button>
            ) : null}
          </div>

          {notice ? (
            <p role="status" className="rounded-md border border-stroke bg-band px-3 py-2 text-[13px] text-ink-2">
              {notice}
            </p>
          ) : null}

          {preview ? (
            <div className="mt-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Preview</p>
              <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
                <Kv k="Total rows" v={preview.totalRows} />
                <Kv k="Valid rows" v={preview.validRows} />
                <Kv k="Error rows" v={preview.errorRows} />
                <Kv k="Warnings" v={preview.warnings + preview.identityWarnings} />
                <Kv k="Apps matched" v={preview.willUpdateApplications} />
                <Kv k="Apps to create" v={preview.willCreateApplications} />
                <Kv k="New engagements" v={preview.newEngagements} />
                <Kv k="Iterations" v={preview.newIterations} />
                <Kv k="Duplicate S.no" v={preview.duplicateSNo.join(", ") || "0"} />
              </div>
              <p className="mt-2 text-[12px] text-muted">{preview.iterationDetected}</p>
              {exceptions.length > 0 ? (
                <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-stroke bg-tint-b px-3 py-2">
                  <ul className="space-y-1 text-[12px]">
                    {exceptions.slice(0, 40).map((ex, i) => (
                      <li key={i} className={cn("flex gap-2", ex.severity === "error" ? "text-danger" : "text-muted-2")}>
                        {ex.severity === "error" ? <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : null}
                        <span className="font-semibold">{ex.code}</span>
                        <span>{ex.message}</span>
                      </li>
                    ))}
                    {exceptions.length > 40 ? <li className="text-muted">+ {exceptions.length - 40} more…</li> : null}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm the Excel import now?"
        description="Data is written in a single transaction. Applications/engagements/iterations will be created or updated from the validated preview."
        confirmLabel="Import now"
        pending={busy}
        onConfirm={handleConfirm}
      />
    </>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted">{k}: </span>
      <span className="font-semibold text-ink-2">{v}</span>
    </div>
  );
}

/** Export button (§31): POST → blob download; history recorded server-side. */
export function ExportExcelButton() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const csrf = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="))?.split("=").slice(1).join("");
      const res = await fetch("/api/exports/excel", {
        method: "POST",
        headers: csrf ? { "x-csrf-token": csrf } : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "Export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="(.+)"/.exec(disposition);
      a.href = url;
      a.download = match ? decodeURIComponent(match[1]!) : "PT Tracker exported.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={handleExport} disabled={busy} data-testid="export-excel">
        <FileDown className="h-4 w-4" aria-hidden /> {busy ? "Exporting…" : "Export Excel"}
      </Button>
      {error ? <Badge variant="critical" className="hidden">{error}</Badge> : null}
    </>
  );
}

export function RefreshButton() {
  const router = useRouter();
  return (
    <Button variant="ghost" onClick={() => router.refresh()}>
      <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
    </Button>
  );
}
