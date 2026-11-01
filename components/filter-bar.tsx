import { cn } from "@/lib/utils";
import Link from "next/link";

/**
 * FilterBar — independent filter cluster styling (PPT filter row pattern from
 * the enterprise reference). Presentational; page components wire selection.
 */
export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)} role="search" aria-label="Filters">
      {children}
    </div>
  );
}

export function FilterChip({ active, children, onClick, href }: { active?: boolean; children: React.ReactNode; onClick?: () => void; href?: string }) {
  const classes = cn(
    "rounded-full border px-3 py-1 text-[12px] font-medium transition",
    active ? "border-accent bg-accent text-white" : "border-stroke bg-card text-ink-2 hover:bg-band",
  );
  if (href) {
    return (
      <Link href={href} className={classes} aria-pressed={active}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={classes}>
      {children}
    </button>
  );
}
