"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

/**
 * PT Tracker floaters (user-requested): hover a severity number → Excel
 * Open/Closed pair; hover ⓘ → EVERY iteration (I1..In, open-ended) or the row's
 * remaining Excel columns (Mail Subject, POC, Assigned, dates, Comments).
 * Cards render in a PORTAL at fixed positions, so the scrollable table can
 * never clip, squeeze, or overlap them.
 */

const fmtD = (iso: Date | string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB") : "—";

function Floater({
  trigger,
  content,
  width = 280,
  testId,
}: {
  trigger: React.ReactNode;
  content: React.ReactNode;
  width?: number;
  testId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });
  const anchor = React.useRef<HTMLSpanElement | null>(null);

  const show = React.useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const flipUp = r.bottom + 340 > window.innerHeight;
    setPos({
      top: flipUp ? Math.max(12, r.top - 10) : r.bottom + 8,
      left: Math.max(12, Math.min(r.left, window.innerWidth - width - 16)),
    });
    setOpen(true);
  }, [width]);

  const close = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!open) return;
    const onClose = () => setOpen(false);
    const onMove = (e: MouseEvent) => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inX = e.clientX >= r.left - 10 && e.clientX <= r.right + width + 10;
      const inY = e.clientY >= r.top - 12 && e.clientY <= Math.max(r.bottom, pos.top + 220) + 10;
      if (!(inX && inY)) onClose();
    };
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    document.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("mousemove", onMove);
    };
  }, [open, close, pos.top, width]);

  return (
    <>
      <span
        ref={anchor}
        className="relative inline-flex cursor-help"
        onMouseEnter={show}
        onMouseLeave={close}
        onFocus={show}
        onBlur={close}
        tabIndex={0}
        data-testid={testId}
      >
        {trigger}
      </span>
      {open
        ? createPortal(
            <div
              className="fixed z-50 rounded-xl border border-stroke bg-card px-4 py-3 text-[12px] shadow-[0_12px_30px_rgb(61_32_84/16%)]"
              style={{ top: pos.top, left: pos.left, width, marginTop: open && pos.top > 40 ? 0 : 0 }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* Severity cell — the Excel Open/Closed pair on hover. */

const SEV_DOT: Record<string, string> = {
  critical: "#CF1325",
  high: "#E86B10",
  medium: "#F5A623",
  low: "#4A90D9",
  info: "#9E9E9E",
};

export function SevStat({ sev, total, open, closed }: { sev: "critical" | "high" | "medium" | "low" | "info"; total: number; open: number; closed: number }) {
  return (
    <Floater
      testId={total > 0 ? `sev-${sev}-${total}` : undefined}
      trigger={
        <span className={total > 0 ? "font-semibold underline decoration-stroke decoration-dotted underline-offset-4" : "text-muted"}>{total}</span>
      }
      content={
        <>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV_DOT[sev] }} aria-hidden />
            <span className="font-semibold capitalize text-ink">{sev}</span>
            <span className="ml-auto text-muted">total {total}</span>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-danger/5 px-2 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Open</p>
              <p className="font-display text-2xl leading-none text-danger">{open}</p>
            </div>
            <div className="rounded-lg bg-good/5 px-2 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Closed</p>
              <p className="font-display text-2xl leading-none text-good">{closed}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted">Excel Open/Closed matrix pair — open includes open/new/not fixed/not retested.</p>
        </>
      }
    />
  );
}

/* Iterations floater — every iteration with dates/status (I1..In). */

export interface IterationFloaterRow {
  number: number;
  name: string;
  statusLabel: string;
  reportDate: string | null; // ISO string (serialized over the server boundary)
}

export function IterationsFloater({ iterations }: { iterations: IterationFloaterRow[] }) {
  return (
    <Floater
      testId={iterations.length > 0 ? `iter-${iterations[0]!.number}` : undefined}
      trigger={
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          {iterations.length > 0 ? `I${iterations[iterations.length - 1]!.number}` : "—"}
          {iterations.length > 1 ? (
            <span className="rounded-full bg-accent/10 px-1.5 text-[10px] font-semibold text-accent-deep">×{iterations.length}</span>
          ) : null}
        </span>
      }
      content={
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Iterations ({iterations.length})</p>
          <ul className="mt-1.5 space-y-1.5">
            {iterations.length === 0 ? <li className="text-muted">No iterations recorded.</li> : null}
            {iterations.map((it) => (
              <li key={it.number} className="flex items-start gap-2">
                <span className="mt-0.5 min-w-[2rem] rounded-md bg-tint-b px-1.5 py-0.5 text-center text-[11px] font-semibold text-ink-2">I{it.number}</span>
                <span className="min-w-0">
                  <span className="block text-ink-2">
                    {it.name} · <span className="text-muted">{it.statusLabel}</span>
                  </span>
                  <span className="text-[11px] text-muted">report date: {fmtD(it.reportDate)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      }
    />
  );
}

/* Details floater — the row's remaining Excel columns. */

export interface DetailField {
  label: string;
  value: string | null;
}

export function DetailsFloater({ fields }: { fields: DetailField[] }) {
  const present = fields.filter((f) => f.value !== null && f.value !== "");
  return (
    <Floater
      testId="row-details"
      width={320}
      trigger={
        <span className="text-muted transition hover:text-accent" aria-hidden>
          <Info className="h-4 w-4" />
        </span>
      }
      content={
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Row details (Excel columns)</p>
          <dl className="mt-1.5 space-y-1.5">
            {present.length === 0 ? <p className="text-muted">No extra columns filled for this application.</p> : null}
            {present.map((f) => (
              <div key={f.label} className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-muted">{f.label}</dt>
                <dd className="min-w-0 break-words text-right text-ink-2">{f.value}</dd>
              </div>
            ))}
          </dl>
        </>
      }
    />
  );
}
