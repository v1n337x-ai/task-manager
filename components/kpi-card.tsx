import { cn } from "@/lib/utils";

type Accent = "critical" | "high" | "medium" | "low" | "info" | "good" | "progress" | "accent" | "ink";

const ACCENT_VAR: Record<Accent, string> = {
  critical: "var(--color-sev-critical)",
  high: "var(--color-sev-high)",
  medium: "var(--color-sev-medium)",
  low: "var(--color-sev-low)",
  info: "var(--color-sev-info)",
  good: "var(--color-good)",
  progress: "var(--color-progress)",
  accent: "var(--color-accent)",
  ink: "var(--color-ink)",
};

/**
 * KpiCard — exact PPT KPI anatomy (brief section 44):
 * rounded card + top accent bar + Bebas number + Poppins caption.
 * Data is always provided by callers from the DB — never hardcoded estate metrics.
 */
export function KpiCard({
  label,
  number,
  accent = "ink",
  supporting,
  className,
  children,
}: {
  label: string;
  number: string | number;
  accent?: Accent;
  supporting?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("kpi-card p-4 pt-5", className)}
      style={{ ["--kpi-accent" as string]: ACCENT_VAR[accent] }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="font-display mt-1 text-[40px] leading-none" style={{ color: ACCENT_VAR[accent] }}>
        {number}
      </p>
      {supporting ? <p className="mt-1.5 text-[12px] text-muted">{supporting}</p> : null}
      {children}
    </div>
  );
}
