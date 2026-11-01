import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/badges";
import { FilterBar, FilterChip } from "@/components/filter-bar";
import { DbUnavailableState } from "@/components/states";
import { ImportExcelDialog, ExportExcelButton, RefreshButton } from "./excel-actions";
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

  let rows = null as Awaited<ReturnType<typeof listTrackerApps>> | null;
  let dbError: string | null = null;
  try {
    rows = await listTrackerApps({ q, type, status, scope, severity, fixedState, iterationNumber: Number.isInteger(iterationNumber) ? iterationNumber : undefined });
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
            <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white">Search</button>
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
              href={trackerUrl({ type, status, scope, fixedState: fixedStateRaw, iteration: iterationParam, severity: severity === s ? undefined : s })}
              active={severity === s}
            >
              {s[0]!.toUpperCase() + s.slice(1)}
            </FilterChip>
          ))}
        </FilterBar>

        {dbError ? (
          <DbUnavailableState className="mt-5" />
        ) : (
          <DataTable
            className="mt-4"
            caption="Application tracker"
            rows={rows}
            columns={[
              { key: "sno", header: "S.No", render: (r) => r.sNo ?? "—" },
              {
                key: "name",
                header: "Application",
                render: (r) => (
                  <Link href={`/pt-tracker/${r.id}`} className="font-medium text-progress underline-offset-4 hover:underline" data-testid={`app-${r.id}`}>
                    {r.displayName}
                  </Link>
                ),
              },
              { key: "url", header: "URL", render: (r) => <span className="text-muted">{(r.target ?? "—").slice(0, 42)}</span> },
              { key: "assess", header: "Assessment", render: (r) => <span className="text-[12px] text-muted-2">{r.assessmentTypeLabel}</span> },
              { key: "ptstatus", header: "PT Status", render: (r) => <StatusBadge value={r.statusLabel.toLowerCase().replace(/ /g, "_")} label={r.statusLabel} /> },
              { key: "iter", header: "Iteration", render: (r) => (r.latestIteration ? `I${r.latestIteration.number}` : "—") },
              { key: "total", header: "Total", render: (r) => <strong>{r.counts.total}</strong> },
              { key: "crit", header: "Crit", render: (r) => r.counts.critical },
              { key: "high", header: "High", render: (r) => r.counts.high },
              { key: "med", header: "Med", render: (r) => r.counts.medium },
              { key: "low", header: "Low", render: (r) => r.counts.low },
              { key: "pending", header: "Pending", render: (r) => r.counts.pending },
              { key: "fixed", header: "Fixed", render: (r) => r.counts.fixed },
              { key: "car", header: "CAR", render: (r) => r.counts.car },
              { key: "updated", header: "Last Update", render: (r) => <span className="text-muted">{formatDate(r.updatedAt)}</span> },
            ]}
            emptyTitle="No applications match"
            emptyHint="Adjust filters or import the PT Tracker workbook (fixed 39-column Excel contract)."
          />
        )}
      </PageBody>
    </>
  );
}
