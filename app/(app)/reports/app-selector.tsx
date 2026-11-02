"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

/**
 * Application selector for the Reports screen (user-requested redesign):
 * pick an app → the reports page scopes every panel to it (URL-param driven,
 * reproducible). No giant register table.
 */
export function ApplicationSelector({ apps, current }: { apps: { id: number; displayName: string }[]; current?: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    setBusy(true);
    if (value === "") router.push("/reports");
    else router.push(`/reports?application=${value}`);
  }

  return (
    <div className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white shadow-sm" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
            <path d="M12 3.5 21 21h-4.6l-1.9-4h-5l-1.9 4H3L12 3.5Z" fill="#fff" />
            <path d="M12 9.6 14.2 14h-4.4L12 9.6Z" fill="#E0550C" />
          </svg>
        </div>
        <div>
          <label htmlFor="reports-app-select" className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Application report
          </label>
          <p className="text-[12px] text-muted">Select an application to scope the report</p>
        </div>
      </div>
      <div className="relative min-w-[260px]">
        <select
          id="reports-app-select"
          value={current ? String(current) : ""}
          onChange={onChange}
          disabled={busy}
          className="w-full appearance-none rounded-lg border border-stroke bg-card py-2 pl-3 pr-9 text-[13px] text-ink-2 shadow-sm focus:outline-none"
        >
          <option value="">— Select application —</option>
          {apps.map((app) => (
            <option key={app.id} value={app.id}>
              {app.displayName}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </div>
  );
}
