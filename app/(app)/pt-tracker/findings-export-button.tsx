"use client";

import * as React from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Export the Master Summary + per-app Iteration 1/2 findings workbook. */
export function ExportFindingsWorkbookButton() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const csrf = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="))?.split("=").slice(1).join("");
      const res = await fetch("/api/findings/export", {
        method: "POST",
        headers: csrf ? { "x-csrf-token": csrf } : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Findings export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="(.+)"/.exec(disposition);
      a.href = url;
      a.download = match ? decodeURIComponent(match[1]!) : "VAPT Findings Workbook.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Findings export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={handleExport} disabled={busy} data-testid="export-findings-workbook">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
        {busy ? "Exporting…" : "Export findings workbook"}
      </Button>
      {error ? <span role="alert" className="text-[11px] text-danger">{error}</span> : null}
    </>
  );
}
