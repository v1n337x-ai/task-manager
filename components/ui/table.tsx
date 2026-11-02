import * as React from "react";
import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(function Table({ className, ...props }, ref) {
  return (
    <div className="tm-table">
      <div className="overflow-x-auto">
        <table ref={ref} className={cn("w-full border-collapse text-left text-[13px]", className)} {...props} />
      </div>
    </div>
  );
});

const THead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(function THead(
  { className, ...props },
  ref,
) {
  return <thead ref={ref} className={className} {...props} />;
});

const TBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(function TBody(
  { className, ...props },
  ref,
) {
  return <tbody ref={ref} className={className} {...props} />;
});

const TR = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(function TR({ className, ...props }, ref) {
  return <tr ref={ref} className={cn("align-middle", className)} {...props} />;
});

const TH = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(function TH({ className, ...props }, ref) {
  return <th ref={ref} className={cn("px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3", className)} {...props} />;
});

const TD = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(function TD({ className, ...props }, ref) {
  return <td ref={ref} className={cn("px-4 py-2.5 align-top text-ink-2", className)} {...props} />;
});

export { Table, THead, TBody, TR, TH, TD };
