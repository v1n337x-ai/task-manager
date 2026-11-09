"use client";

import * as React from "react";
import { Palette, Save, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hsl(hex: string): { hue: number; saturation: number } | null {
  if (!HEX_RE.test(hex)) return null;
  const v = hex.toLowerCase();
  const r = parseInt(v.slice(1, 3), 16) / 255;
  const g = parseInt(v.slice(3, 5), 16) / 255;
  const b = parseInt(v.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const saturation = max === 0 ? 0 : delta / max;
  if (delta === 0) return { hue: 0, saturation };
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { hue, saturation };
}

const isAkasaPrimary = (hex: string) => {
  const color = hsl(hex);
  return !!color && color.hue >= 8 && color.hue <= 48 && color.saturation >= 0.35;
};

const isAkasaSecondary = (hex: string) => {
  const color = hsl(hex);
  return !!color && color.hue >= 255 && color.hue <= 302 && color.saturation >= 0.12;
};

export function BrandingPanel({ initial }: { initial: { primary: string; secondary: string } }) {
  const [primary, setPrimary] = React.useState(initial.primary);
  const [secondary, setSecondary] = React.useState(initial.secondary);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleSave() {
    setBusy(true);
    setMessage(null);
    try {
      const csrf = document.cookie
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("tm_csrf="))
        ?.split("=")
        .slice(1)
        .join("=");
      const res = await fetch("/api/settings/branding", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-csrf-token": csrf } : {}),
        },
        body: JSON.stringify({ primary, secondary }),
      });
      const data = (await res.json()) as { colors?: { primary: string; secondary: string }; error?: { message?: string } };
      if (!res.ok || !data.colors) {
        setMessage({ kind: "error", text: data.error?.message ?? "Save failed." });
        return;
      }
      setPrimary(data.colors.primary);
      setSecondary(data.colors.secondary);
      setMessage({ kind: "ok", text: "Saved. New exports and the web UI will use these colors." });
    } finally {
      setBusy(false);
    }
  }

  const valid = isAkasaPrimary(primary) && isAkasaSecondary(secondary);

  return (
    <div className="panel px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Theme colors</h2>
          <p className="mt-1 text-[13px] text-muted">
            Akasa Air orange and violet colors used by the web UI and Excel exports. PPT styling is not changed by these settings.
          </p>
        </div>
        <Palette className="h-5 w-5 text-muted" aria-hidden />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="brand-primary">Primary color</Label>
          <div className="mt-1 flex items-center gap-2">
            <input
              aria-label="Primary color picker"
              type="color"
              value={HEX_RE.test(primary) ? primary : "#ff8c42"}
              onChange={(e) => setPrimary(e.target.value)}
              className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-stroke bg-card p-0.5"
            />
            <Input
              id="brand-primary"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder="#ff8c42"
              className="font-mono"
            />
          </div>
          <p className="mt-1 text-[12px] text-muted">Akasa orange only — used for the main band and primary accents.</p>
        </div>
        <div>
          <Label htmlFor="brand-secondary">Secondary color</Label>
          <div className="mt-1 flex items-center gap-2">
            <input
              aria-label="Secondary color picker"
              type="color"
              value={HEX_RE.test(secondary) ? secondary : "#9b7bb5"}
              onChange={(e) => setSecondary(e.target.value)}
              className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-stroke bg-card p-0.5"
            />
            <Input
              id="brand-secondary"
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              placeholder="#9b7bb5"
              className="font-mono"
            />
          </div>
          <p className="mt-1 text-[12px] text-muted">Akasa violet only — used for tables, rules and secondary accents.</p>
        </div>
      </div>

      <div className="mt-4 flex h-9 overflow-hidden rounded-md border border-stroke">
        <div className="flex h-full flex-1 items-center justify-center" style={{ backgroundColor: primary }}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white">Primary</span>
        </div>
        <div className="flex h-full flex-1 items-center justify-center" style={{ backgroundColor: secondary }}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white">Secondary</span>
        </div>
      </div>

      {message ? (
        <p role="status" className={message.kind === "error" ? "mt-3 text-[13px] text-danger" : "mt-3 text-[13px] text-good"}>
          {message.text}
        </p>
      ) : null}

      <div className="mt-4">
        <Button variant="accent" onClick={handleSave} disabled={busy || !valid}>
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {busy ? "Saving…" : "Save colors"}
        </Button>
      </div>
    </div>
  );
}
