import { cn } from "@/lib/utils";

export interface TimelineEntry {
  at: string; // formatted display time
  title: string;
  detail?: string;
  accent?: "accent" | "good" | "progress" | "muted";
}

/**
 * Timeline — conversation-ready foundation component (brief section 45).
 * Uses the PPT tick-note motif (thin accent tick + body copy).
 */
export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  if (entries.length === 0) {
    return <p className="text-[13px] text-muted">No entries yet.</p>;
  }
  return (
    <ol className={cn("relative space-y-4 border-l border-stroke-soft pl-5", className)}>
      {entries.map((entry, index) => (
        <li key={index} className="relative">
          <span
            aria-hidden
            className={cn(
              "absolute -left-[22px] top-1 h-3 w-[3px] rounded-full",
              entry.accent === "good"
                ? "bg-good"
                : entry.accent === "progress"
                  ? "bg-progress"
                  : entry.accent === "muted"
                    ? "bg-muted"
                    : "bg-accent",
            )}
          />
          <p className="text-[12px] text-muted">{entry.at}</p>
          <p className="text-[14px] font-medium text-ink">{entry.title}</p>
          {entry.detail ? <p className="mt-0.5 text-[13px] text-muted-2">{entry.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}
