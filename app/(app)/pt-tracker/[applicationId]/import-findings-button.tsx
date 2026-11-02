"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2 } from "lucide-react";

function csrf(): string | null {
  const raw = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

/**
 * Import an analyst finding-list workbook (vapt.xlsx shape: # | Name of the
 * vulnerability | Severity) into THIS application's findings (user-requested
 * pipeline completion). Per-row truth report; duplicates are skipped.
 */
export function ImportFindingsButton({ applicationId }: { applicationId: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload() {
    const input = inputRef.current;
    const file = input?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("applicationId", String(applicationId));
      const res = await fetch("/api/findings/import", {
        method: "POST",
        headers: { ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Import failed.");
        return;
      }
      const r = data.result as { created: { code: string }[]; skipped: { title: string }[]; warnings: string[] };
      setMsg(`Imported ${r.created.length} finding(s) · skipped ${r.skipped.length} · warnings ${r.warnings.length}.`);
      if (input) input.value = "";
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-2 border border-stroke bg-card px-3 py-2 text-[13px] text-ink-2 transition hover:bg-xlsx-data">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />}
        Import findings (.xlsx)
        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={upload} disabled={busy} />
      </label>
      {msg ? <span className="text-[12px] text-good">{msg}</span> : null}
      {error ? <span role="alert" className="text-[12px] text-danger">{error}</span> : null}
    </div>
  );
}
