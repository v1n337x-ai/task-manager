import { cn } from "@/lib/utils";

/**
 * PageHeader — the PPT content-slide chrome: ink band, Bebas title,
 * red rule, muted subtitle (DL-01 §2, DL-08 §4).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("brand-band", className)}>
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-3 px-6 py-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-none tracking-wide">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-[13px] text-muted-2">{subtitle}</p> : null}
        </div>
        {actions ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2 pb-0.5">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Content wrapper aligned with the 32px page margin + 20px grid gap rules. */
export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto max-w-7xl px-6 py-6", className)}>{children}</div>;
}
