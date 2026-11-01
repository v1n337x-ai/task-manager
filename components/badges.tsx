import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Severity badge — PPT severity palette + visible text label (a11y, §25). */
export function SeverityBadge({ value, className }: { value: string; className?: string }) {
  const variantMap: Record<string, "critical" | "high" | "medium" | "low" | "info" | "neutral"> = {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
    info: "info",
  };
  const variant = variantMap[value.toLowerCase()] ?? "neutral";
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

/** Status badge — Fixed green / Not Fixed red with text labels, never colour-only. */
export function StatusBadge({ value, label, className }: { value: string; label?: string; className?: string }) {
  const v = value.toLowerCase();
  const variantMap: Record<string, "good" | "critical" | "progress" | "hold" | "medium" | "info" | "muted" | "neutral"> = {
    fixed: "good",
    passed: "good",
    completed: "good",
    included: "neutral",
    open: "critical",
    not_fixed: "critical",
    failed: "critical",
    in_progress: "progress",
    active: "progress",
    on_hold: "hold",
    pending: "medium",
    planned: "muted",
    not_tested: "muted",
    not_retested: "muted",
    unknown: "muted",
    removed: "info",
    out_of_scope: "info",
    not_applicable: "info",
    accepted_risk: "info",
    initiated: "muted",
    duplicate: "info",
    inactive: "muted",
    cancelled: "muted",
  };
  const variant = variantMap[v] ?? "neutral";
  const text = label ?? v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge variant={variant} className={cn(className)}>
      {text}
    </Badge>
  );
}
