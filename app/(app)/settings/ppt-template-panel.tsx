"use client";

import * as React from "react";
import { FileUp, Trash2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PptTemplateAnalysis = {
  filename: string;
  sha256: string;
  storedBytes: number;
  slideCount: number;
  slideSize: { cx: number; cy: number; widthInches: number; heightInches: number } | null;
  themes: Array<{ name: string; colors: string[] }>;
  media: Array<{ name: string; ext: string; bytes: number }>;
  fonts: string[];
  slides: Array<{ number: number; title: string | null; role: string; textPreview: string[]; hasTable: boolean; hasChart: boolean }>;
  aiAvailable: boolean;
  warnings: string[];
};

function csrf(): string | null {
  const row = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
  return row ? row.split("=").slice(1).join("=") : null;
}

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function PptTemplatePanel({ initial }: { initial: PptTemplateAnalysis | null }) {
  const [analysis, setAnalysis] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  }

  async function upload(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fd = new FormData();
      fd.append("template", file);
      const res = await fetch("/api/settings/ppt-template", { method: "POST", body: fd, headers: csrf() ? { "x-csrf-token": csrf()! } : {} });
      const data = (await res.json()) as { template?: PptTemplateAnalysis; error?: { message?: string } };
      if (!res.ok || !data.template) {
        setError(data.error?.message ?? "Template upload failed.");
        return;
      }
      setAnalysis(data.template);
      setNotice("Template saved. Future PPT exports will use this design and fill it with live tracker data.");
    } catch {
      setError("Template upload failed. The current PPT export remains unchanged.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove the uploaded PPT template? The existing built-in PPT export will be used again.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/ppt-template", { method: "DELETE", headers: csrf() ? { "x-csrf-token": csrf()! } : {} });
      if (!res.ok) throw new Error("Remove failed.");
      setAnalysis(null);
      setNotice("Template removed. Future PPT exports will use the built-in deck again.");
    } catch {
      setError("Template removal failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-muted" aria-hidden />
              PPT template
            </CardTitle>
            <CardDescription>
              Upload a client presentation. The app analyses its slides, layout, themes, fonts and media, then future PPT exports preserve that design and update only the values from the PT Tracker.
            </CardDescription>
          </div>
          <Badge variant={analysis ? "good" : "muted"}>{analysis ? "Template active" : "No template"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block cursor-pointer rounded-lg border border-dashed border-stroke bg-tint-b px-4 py-6 text-center transition hover:bg-xlsx-data">
          <input type="file" accept=".pptx" className="sr-only" onChange={onFileChange} disabled={busy} />
          <p className="text-[13px] font-semibold text-ink-2">{busy ? "Analysing template…" : "Drop a .pptx template here"}</p>
          <p className="mt-1 text-[12px] text-muted">or click to browse · max 25 MB · analysis is automatic</p>
        </label>

        <div className="flex gap-2">
          {analysis ? <Button variant="outline" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" aria-hidden /> Remove template</Button> : null}
          {busy ? <span className="inline-flex items-center gap-2 text-[12px] text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Working…</span> : null}
        </div>

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="flex items-start gap-2 rounded-md border border-good/30 bg-good/5 px-3 py-2 text-[13px] text-good">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {notice}
          </p>
        ) : null}

        {analysis ? (
          <div className="space-y-3 rounded-lg border border-stroke bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div><p className="text-[11px] uppercase tracking-wide text-muted">File</p><p className="break-all text-[13px] font-semibold">{analysis.filename}</p></div>
              <div><p className="text-[11px] uppercase tracking-wide text-muted">Slides</p><p className="text-[13px] font-semibold">{analysis.slideCount}</p></div>
              <div><p className="text-[11px] uppercase tracking-wide text-muted">Size</p><p className="text-[13px] font-semibold">{analysis.slideSize ? `${analysis.slideSize.widthInches.toFixed(2)}" × ${analysis.slideSize.heightInches.toFixed(2)}"` : "Unknown"}</p></div>
              <div><p className="text-[11px] uppercase tracking-wide text-muted">File size</p><p className="text-[13px] font-semibold">{formatBytes(analysis.storedBytes)}</p></div>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Detected assets</p>
              <p className="mt-1 text-[13px]">{analysis.media.length} media · {analysis.themes.length} theme(s) · {analysis.fonts.length ? analysis.fonts.slice(0, 6).join(", ") : "No font metadata"}</p>
              {analysis.themes[0]?.colors.length ? (
                <div className="mt-2 flex gap-1">{analysis.themes[0].colors.slice(0, 8).map((c) => <span key={c} className="h-4 w-4 rounded-full border border-stroke" style={{ backgroundColor: c }} title={c} />)}</div>
              ) : null}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted">Slide analysis</p>
              <ul className="mt-1 space-y-1 text-[12px] text-muted-2">
                {analysis.slides.slice(0, 10).map((s) => (
                  <li key={s.number}><span className="font-semibold text-ink-2">{s.number}. {s.title ?? "Untitled"}</span> · {s.role}{s.hasTable ? " · table" : ""}{s.hasChart ? " · chart" : ""}</li>
                ))}
                {analysis.slides.length > 10 ? <li>+ {analysis.slides.length - 10} more slides</li> : null}
              </ul>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
