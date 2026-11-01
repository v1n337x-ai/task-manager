"use client";

import * as React from "react";
import { FileDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function csrf(): string | null {
  const raw = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

/** Export PPT — same live report scope as the current surface (§47/§48). */
export function ExportPptButton({ filtersQS }: { filtersQS: string }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams(filtersQS);
      const body: Record<string, unknown> = {};
      if (params.get("application")) body.applicationId = Number(params.get("application"));
      if (params.get("severity")) body.severity = params.get("severity");
      if (params.get("status")) body.statusValue = params.get("status");
      if (params.get("iteration")) body.iterationNumber = Number(params.get("iteration"));

      const res = await fetch("/api/reports/ppt", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "PPT export failed.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const match = /filename="(.+)"/.exec(res.headers.get("Content-Disposition") ?? "");
      a.href = url;
      a.download = match ? decodeURIComponent(match[1]!) : "VAPT_Report.pptx";
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
      <Button variant="accent" onClick={handleExport} disabled={busy} data-testid="export-ppt">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
        Export PPT
      </Button>
      {error ? <span role="alert" className="text-[12px] text-accent">{error}</span> : null}
    </>
  );
}
