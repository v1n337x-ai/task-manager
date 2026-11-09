import { cn } from "@/lib/utils";

/**
 * StatusFillCell — the workbook look: the ENTIRE table cell is painted with
 * the status fill (Excel annotation), text centered, square, edged by the
 * table's thin black line.
 */
const FILLS: Record<string, string> = {
  completed: "bg-sev-low text-white",
  in_progress: "bg-[#FCEE21] text-ink",
  pending: "bg-xlsx-peach text-ink",
  on_hold: "bg-xlsx-band text-ink",
  planned: "bg-xlsx-data text-ink-2",
  started: "bg-xlsx-peach text-ink",
  cancelled: "bg-sev-critical text-white",
  inactive: "bg-xlsx-band text-muted",
  // Finding iteration states (findings table cells)
  open: "bg-xlsx-peach text-ink",
  new: "bg-[#FCEE21] text-ink",
  fixed: "bg-sev-low text-white",
  not_fixed: "bg-sev-critical text-white",
  not_retested: "bg-xlsx-band text-muted",
  retested: "bg-sev-low text-white",
};

export function statusFillClass(statusLabel: string): string {
  const key = statusLabel.toLowerCase().trim().replace(/ /g, "_");
  return FILLS[key] ?? "bg-card text-ink-2";
}

/** Severity fills for full-cell severity columns. */
const SEV_FILL: Record<string, string> = {
  critical: "bg-sev-critical text-white",
  high: "bg-sev-high text-white",
  medium: "bg-sev-medium text-ink",
  low: "bg-sev-low text-white",
  info: "bg-sev-info text-white",
  unknown: "bg-xlsx-data text-ink-2",
};

export function severityFillClass(severityValue: string): string {
  return SEV_FILL[severityValue.toLowerCase().trim()] ?? "bg-xlsx-data text-ink-2";
}

export function StatusFillCell({ value }: { value: string }) {
  return (
    <span className={cn("fill-cell flex min-h-[40px] w-full items-center justify-center px-3 py-2 text-center text-[12px] font-bold leading-tight", statusFillClass(value))}>{value}</span>
  );
}

export function SeverityFillCell({
  severityValue,
  label,
}: {
  severityValue: string;
  label: string;
}) {
  return (
    <span className={cn("fill-cell flex min-h-[40px] w-full items-center justify-center px-3 py-2 text-center text-[12px] font-bold leading-tight", severityFillClass(severityValue))}>{label}</span>
  );
}
