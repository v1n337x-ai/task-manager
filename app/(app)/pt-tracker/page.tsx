import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { FilterBar, FilterChip } from "@/components/filter-bar";
import { DbUnavailableState } from "@/components/states";
import { ImportExcelDialog, ExportExcelButton, RefreshButton } from "./excel-actions";
import { ExportFindingsWorkbookButton } from "./findings-export-button";
import { DetailsFloater, IterationsFloater, SevStat } from "./floaters";
import { StatusFillCell } from "@/components/status-fill";
import { listTrackerApps, summarize } from "@/lib/services/tracker-service";
import { formatDate } from "@/lib/utils";

function trackerUrl(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const qs = sp.toString();
  return `/pt-tracker${qs ? `?${qs}` : ""}`;
}

export const metadata: Metadata = { title: "PT Tracker" };

/**
 * PT Tracker main page (§5-§7): dense operational table — every number derived
 * from FINDING records via tracker-service (§36/§37/§56); never hardcoded.
 * Filters (§41) + server-backed search (§42) via route query params.
 */
export default async function PtTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pick = (k: string) => (Array.isArray(params[k]) ? params[k]?.[0] : (params[k] as string | undefined));

  const type = pick("type");
  const status = pick("status");
  const scope = pick("scope");
  const severity = pick("severity");
  const fixedStateRaw = pick("fixedState");
  const fixedState = ["fixed", "not_fixed", "new", "pending"].includes(fixedStateRaw ?? "")
    ? (fixedStateRaw as "fixed" | "not_fixed" | "new" | "pending")
    : undefined;
  const iterationParam = pick("iteration");
  const iterationNumber = iterationParam ? Number(iterationParam) : undefined;
  const q = pick("q");
  const sortRaw = pick("sort");
  const sort = ["name", "scanDate", "total", "critical", "high"].includes(sortRaw ?? "") ? (sortRaw as "name" | "scanDate" | "total" | "critical" | "high") : undefined;

  let rows = null as Awaited<ReturnType<typeof listTrackerApps>> | null;
  let dbError: string | null = null;
  try {
    rows = await listTrackerApps({ q, type, status, scope, severity, fixedState, iterationNumber: Number.isInteger(iterationNumber) ? iterationNumber : undefined, sort });
  } catch (error) {
    dbError = String(error);
  }

  const totals = rows ? summarize(rows) : null;

  return (
    <>
      <PageHeader
        title="PT TRACKER"
        subtitle="Application vulnerability tracking and retest management"
        actions={
          <div className="flex items-center gap-2">
            <ImportExcelDialog />
            <ExportExcelButton />
            <ExportFindingsWorkbookButton />
            <Link
              href="/master-data"
              className="inline-flex h-9 items-center justify-center rounded-lg bg-card px-4 text-[13px] font-semibold text-ink-2 shadow-sm transition hover:bg-band"
            >
              Add Application
            </Link>
            <RefreshButton />
          </div>
        }
      />

      <PageBody>
        {totals ? (
          <section aria-label="Live totals" className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            <KpiCard label="Applications" number={totals.applications} accent="ink" />
            <KpiCard label="Total findings" number={totals.total} accent="accent" supporting={`${totals.pending} pending`} />
            <KpiCard label="Critical" number={totals.critical} accent="critical" />
            <KpiCard label="High" number={totals.high} accent="high" />
            <KpiCard label="Pending" number={totals.pending} accent="progress" supporting={`${totals.fixed} fixed · ${totals.notFixed} not fixed`} />
            <KpiCard label="New (latest)" number={totals.newInLatestIteration} accent="medium" supporting={`${totals.testCases} test cases · CAR ${totals.car}`} />
          </section>
        ) : null}

        <FilterBar className="mt-5">
          <form action="/pt-tracker" className="flex flex-1 items-center gap-2" role="search">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search application, URL…"
              aria-label="Search applications"
              className="w-64 rounded-lg border border-stroke bg-card px-3 py-1.5 text-[13px]"
            />
            {type ? <input type="hidden" name="type" value={type} /> : null}
            {fixedState ? <input type="hidden" name="fixedState" value={fixedState} /> : null}
            {severity ? <input type="hidden" name="severity" value={severity} /> : null}
            <button type="submit" className="rounded-none bg-slate px-3 py-1.5 text-[12px] font-semibold text-white">Search</button>
          </form>
          <span className="text-[12px] text-muted">Fixed/NotFixed:</span>
          <FilterChip href={trackerUrl({ type, status, scope, severity, iteration: iterationParam })} active={false}>All</FilterChip>
          <FilterChip href={trackerUrl({ type, status, scope, severity, iteration: iterationParam, fixedState: "fixed" })} active={fixedStateRaw === "fixed"}>Fixed</FilterChip>
          <FilterChip href={trackerUrl({ type, status, scope, severity, iteration: iterationParam, fixedState: "not_fixed" })} active={fixedStateRaw === "not_fixed"}>Not Fixed</FilterChip>
          <FilterChip href={trackerUrl({ type, status, scope, severity, iteration: iterationParam, fixedState: "new" })} active={fixedStateRaw === "new"}>New</FilterChip>
          <FilterChip href={trackerUrl({ type, status, scope, severity, iteration: iterationParam, fixedState: "pending" })} active={fixedStateRaw === "pending"}>Pending</FilterChip>
          <span className="text-[12px] text-muted">Severity:</span>
          {(["critical", "high", "medium", "low"] as const).map((s) => (
            <FilterChip
              key={s}
              href={trackerUrl({ type, status, scope, fixedState: fixedStateRaw, iteration: iterationParam, severity: severity === s ? undefined : s, sort })}
              active={severity === s}
            >
              {s[0]!.toUpperCase() + s.slice(1)}
            </FilterChip>
          ))}
            <span className="text-[12px] text-muted">Sort:</span>
            {(["name", "scanDate", "total", "critical", "high"] as const).map((s) => (
              <FilterChip
                key={s}
                href={trackerUrl({ type, status, scope, fixedState: fixedStateRaw, iteration: iterationParam, severity, sort: sort === s ? undefined : s })}
                active={sort === s}
              >
                {s === "name" ? "Name" : s === "scanDate" ? "Scan date" : s === "total" ? "Total" : s === "critical" ? "Critical" : "High"}
              </FilterChip>
            ))}
        </FilterBar>

        {dbError ? (
          <DbUnavailableState className="mt-5" />
        ) : (
          <div className="tracker-table-shell mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stroke-soft bg-card px-5 py-4">
              <div>
                <h2 className="font-display text-xl leading-none tracking-wide text-ink">Application Register</h2>
                <p className="mt-1 text-[12px] text-muted">{rows?.length ?? 0} applications · live counts from findings</p>
              </div>
              <span className="rounded-full bg-accent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-deep">Live data</span>
            </div>
          <DataTable
            className="mt-0"
            caption="Application tracker — PT Tracker v1.0 columns (minimized via floaters)"
            rows={rows}
            columns={[
              { key: "sno", header: "S.No", className: "w-12 text-center text-muted", render: (r) => r.sNo ?? "—" },
              {
                key: "name",
                header: "Application",
                className: "min-w-[160px]",
                render: (r) => (
                  <Link href={`/pt-tracker/${r.id}`} className="font-medium text-progress underline-offset-4 hover:underline" data-testid={`app-${r.id}`}>
                    {r.displayName}
                  </Link>
                ),
              },
              { key: "scope", header: "Int. / Ext.", className: "whitespace-nowrap", render: (r) => <span className="text-muted-2">{r.scopeLabel}</span> },
              {
                key: "url",
                header: "Web URL / API",
                className: "max-w-[210px]",
                render: (r) =>
                  r.target ? (
                    <a
                      href={r.target}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={r.target}
                      className="block max-w-[200px] truncate text-[12px] text-muted-2 hover:text-accent-deep hover:underline"
                    >
                      {r.target}
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  ),
              },
              { key: "type", header: "Type", className: "whitespace-nowrap", render: (r) => <span className="text-muted-2">{r.typeName}</span> },
              { key: "source", header: "Source / tool", className: "whitespace-nowrap", render: (r) => <span className="text-[12px] text-muted-2">{r.assessmentTypeLabel}</span> },
              {
                key: "overall",
                header: "Overall Status",
                className: "overall-status-cell filled-cell text-center whitespace-nowrap",
                render: (r) => <StatusFillCell value={r.overallStatusLabel} />,
              },
              { key: "vulncount", header: "Total Vuln Count", className: "text-center whitespace-nowrap", render: (r) => <strong>{r.counts.total}</strong> },
              { key: "scan", header: "Scan/Report Date", className: "whitespace-nowrap", render: (r) => <span className="text-muted text-[12px]">{r.reportDate ? formatDate(r.reportDate) : "—"}</span> },
              { key: "critical", header: "Critical", className: "text-center whitespace-nowrap px-2", render: (r) => <SevStat sev="critical" total={r.counts.critical} open={r.openBySeverity.critical} closed={r.closedBySeverity.critical} /> },
              { key: "high", header: "High", className: "text-center whitespace-nowrap px-2", render: (r) => <SevStat sev="high" total={r.counts.high} open={r.openBySeverity.high} closed={r.closedBySeverity.high} /> },
              { key: "medium", header: "Medium", className: "text-center whitespace-nowrap px-2", render: (r) => <SevStat sev="medium" total={r.counts.medium} open={r.openBySeverity.medium} closed={r.closedBySeverity.medium} /> },
              { key: "low", header: "Low", className: "text-center whitespace-nowrap px-2", render: (r) => <SevStat sev="low" total={r.counts.low} open={r.openBySeverity.low} closed={r.closedBySeverity.low} /> },
              { key: "info", header: "Info", className: "text-center whitespace-nowrap px-2", render: (r) => <SevStat sev="info" total={r.counts.info} open={r.openBySeverity.info} closed={r.closedBySeverity.info} /> },
              { key: "car", header: "CAR", className: "text-center whitespace-nowrap", render: (r) => r.counts.car },
              { key: "total", header: "Total", className: "text-center whitespace-nowrap", render: (r) => r.counts.total },
              { key: "pending", header: "Pending", className: "text-center whitespace-nowrap", render: (r) => r.counts.pending },
              { key: "closed", header: "Vulns Closed", className: "text-center whitespace-nowrap", render: (r) => r.closed },
              {
                key: "iterations",
                header: "Iterations ⓘ",
                className: "text-center whitespace-nowrap",
                render: (r) => (
                  <IterationsFloater
                    iterations={r.iterations.map((it) => ({
                      number: it.number,
                      name: it.name,
                      statusLabel: it.statusLabel,
                      reportDate: it.reportDate ? it.reportDate.toISOString() : null,
                    }))}
                  />
                ),
              },
              {
                key: "details",
                header: "Details ⓘ",
                className: "w-10 text-center",
                render: (r) => (
                  <DetailsFloater
                    fields={[
                      { label: "Mail Subject", value: r.mailSubject },
                      { label: "Requested date", value: r.requestedDate ? formatDate(r.requestedDate) : null },
                      { label: "POC Task Manager", value: r.poc },
                      { label: "Security Vendor Team", value: r.assignedMembers },
                      { label: "Comments", value: r.comments },
                      { label: "Mail-thread key", value: r.engagementName },
                    ]}
                  />
                ),
              },
            ]}
            emptyTitle="No applications match"
            emptyHint="Adjust filters or import the PT Tracker workbook (fixed 39-column Excel contract)."
          />
          </div>
        )}
      </PageBody>
    </>
  );
}
