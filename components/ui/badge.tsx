import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Badge — pill chips from the PPT chip anatomy. */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-none px-2 py-0.5 text-[11px] font-semibold leading-5",
  {
    variants: {
      variant: {
        // Severity chips follow the WORKBOOK's Excel look (user direction):
        // light accent-tint fill + darker accent text.
        critical: "bg-sev-critical-soft text-sev-critical-text border border-sev-critical",
        high: "bg-sev-high-soft text-sev-high-text border border-sev-high",
        medium: "bg-sev-medium-soft text-sev-medium-text border border-sev-medium",
        low: "bg-sev-low-soft text-sev-low-text border border-sev-low",
        info: "bg-sev-info-soft text-sev-info-text border border-sev-info",
        good: "bg-sev-low-soft text-sev-low-text border border-sev-low",
        progress: "bg-xlsx-peach text-sev-critical-text border border-sev-critical/50",
        accent: "bg-accent text-white",
        hold: "bg-accent-orange text-white",
        muted: "bg-band text-muted",
        neutral: "bg-band text-ink-2 border border-stroke",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  // Colors carry meaning; the text label remains fully readable (a11y).
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
