import { cn } from "@/lib/utils";
import { Inbox, Loader2, TriangleAlert, WifiOff } from "lucide-react";

/** Truthful empty state (brief sections 42/54): never fake data. */
export function EmptyState({ title, hint, className }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={cn("panel flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <p className="text-[14px] font-medium text-ink-2">{title}</p>
      {hint ? <p className="max-w-md text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("panel flex items-center justify-center gap-3 px-6 py-12 text-muted", className)}>
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

/** Safe error surface (brief section 46) — no stack traces. */
export function ErrorState({ title = "Something went wrong", detail, className }: { title?: string; detail?: string; className?: string }) {
  return (
    <div className={cn("panel flex items-center gap-3 border-l-4 border-l-accent px-6 py-5", className)} role="alert">
      <TriangleAlert className="h-5 w-5 text-accent" aria-hidden />
      <div>
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        {detail ? <p className="text-[13px] text-muted">{detail}</p> : null}
      </div>
    </div>
  );
}

export function DbUnavailableState({ className }: { className?: string }) {
  return (
    <ErrorState
      title="Database unavailable"
      detail="The platform database is not reachable right now. Please retry — operations are queued audibly."
      className={className}
    />
  );
}

export { WifiOff };
