"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

/**
 * PT Tracker floaters — BIG hover surface: the whole table CELL is the hot
 * zone (negative-margin block), with a 150ms close grace for diagonal mouse
 * travel and full card-out/in movement. Cards render in a PORTAL at fixed
 * positions, so the scrollable table can never clip or overlap them.
 */

const fmtD = (iso: Date | string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB") : "—";

/** Full-cell hot zone (eats the default td padding, then re-pads itself). */
const CELL_ZONE = "-mx-3 -my-2 flex min-h-[40px] items-center px-3 py-2 transition hover:bg-accent-soft/50";

function Floater({
  trigger,
  content,
  triggerClassName = "",
  width = 280,
  testId,
}: {
  trigger: React.ReactNode;
  content: React.ReactNode;
  triggerClassName?: string;
  width?: number;
  testId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });
  const anchor = React.useRef<HTMLSpanElement | null>(null);
  const card = React.useRef<HTMLDivElement | null>(null);
  const grace = React.useRef<number | null>(null);

  const cancelGrace = React.useCallback(() => {
    if (grace.current !== null) {
      window.clearTimeout(grace.current);
      grace.current = null;
    }
  }, []);

  const gracefulClose = React.useCallback(() => {
    cancelGrace();
    grace.current = window.setTimeout(() => setOpen(false), 150);
  }, [cancelGrace]);

  const show = React.useCallback(() => {
    cancelGrace();
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 340 > window.innerHeight ? Math.max(12, r.top - 10) : r.bottom + 8,
      left: Math.max(12, Math.min(r.left, window.innerWidth - width - 16)),
    });
    setOpen(true);
  }, [width, cancelGrace]);

  React.useEffect(() => {
    if (!open) return;
    const onMove = (e: MouseEvent) => {
      const zones: DOMRect[] = [];
      if (anchor.current) zones.push(anchor.current.getBoundingClientRect());
      if (card.current) zones.push(card.current.getBoundingClientRect());
      const pad = 12;
      const inside = zones.some(
        (r) =>
          e.clientX >= r.left - pad &&
          e.clientX <= r.right + pad &&
          e.clientY >= r.top - pad &&
          e.clientY <= r.bottom + pad,
      );
      if (!inside) gracefulClose();
      else cancelGrace();
    };
    const onScrollOrResize = () => gracefulClose();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousemove", onMove);
      cancelGrace();
    };
  }, [open, gracefulClose, cancelGrace]);

  return (
    <>
      <span
        ref={anchor}
        className={`relative cursor-help focus:outline-none ${triggerClassName}`}
        onMouseEnter={show}
        onMouseLeave={gracefulClose}
        onFocus={show}
        onBlur={gracefulClose}
        tabIndex={0}
        data-testid={testId}
      >
        {trigger}
      </span>
      {open
        ? createPortal(
            <div
              ref={card}
              className="fixed z-50 rounded-none border border-xlsx-band bg-card px-4 py-3 text-[12px] shadow-[0_12px_30px_rgb(61_32_84/16%)]"
              style={{ top: pos.top, left: pos.left, width }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* Severity cell — the whole cell is the hover zone; the Excel Open/Closed pair appears. */

const SEV_DOT: Record<string, string> = {
  critical: "#C00000",
  high: "#ED7D31",
  medium: "#FFC000",
  low: "#70AD47",
  info: "#5B9BD5",
};

export function SevStat({ sev, total, open, closed }: { sev: "critical" | "high" | "medium" | "low" | "info"; total: number; open: number; closed: number }) {
  return (
    <Floater
      testId={total > 0 ? `sev-${sev}-${total}` : undefined}
      triggerClassName={CELL_ZONE}
      trigger={
        <span
          className={
            total > 0
              ? "font-semibold underline decoration-stroke decoration-dotted underline-offset-4"
              : "text-muted"
          }
        >
          {total}
        </span>
      }
      content={
        <>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV_DOT[sev] }} aria-hidden />
            <span className="font-semibold capitalize text-ink">{sev}</span>
            <span className="ml-auto text-muted">total {total}</span>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-none bg-xlsx-peach px-2 py-2" style={{ border: "1px solid var(--color-sev-critical)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sev-critical-text">Open</p>
              <p className="font-display text-2xl leading-none text-sev-critical-text">{open}</p>
            </div>
            <div className="rounded-none bg-xlsx-green px-2 py-2" style={{ border: "1px solid var(--color-sev-low)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sev-low-text">Closed</p>
              <p className="font-display text-2xl leading-none text-sev-low-text">{closed}</p>
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
      triggerClassName={CELL_ZONE + " justify-center"}
      trigger={
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          {iterations.length > 0 ? `I${iterations[iterations.length - 1]!.number}` : "—"}
          {iterations.length > 1 ? (
            <span className="rounded-none bg-accent/10 px-1.5 text-[10px] font-semibold text-accent-deep">×{iterations.length}</span>
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
      triggerClassName={CELL_ZONE + " justify-center"}
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
