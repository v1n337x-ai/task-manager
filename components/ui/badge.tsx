import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Badge — pill chips from the PPT chip anatomy. */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-5",
  {
    variants: {
      variant: {
        neutral: "bg-band text-ink-2 border border-stroke",
        critical: "bg-sev-critical text-white",
        high: "bg-sev-high text-white",
        medium: "bg-sev-medium text-ink",
        low: "bg-sev-low text-white",
        info: "bg-sev-info text-white",
        good: "bg-good text-white",
        progress: "bg-progress text-white",
        accent: "bg-accent text-white",
        hold: "bg-accent-orange text-white",
        muted: "bg-band text-muted",
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
