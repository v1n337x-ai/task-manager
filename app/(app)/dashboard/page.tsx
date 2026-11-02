import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DbUnavailableState, EmptyState } from "@/components/states";
import { DataTable } from "@/components/data-table";
import { generateDashboardReport } from "@/lib/services/reporting/report-service";
import { SeverityDoughnut, StatusBars, ApplicationBars } from "./dashboard-charts";
import { ExportPptButton } from "./export-ppt-button";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Final live dashboard (Phase 7 §6-§11): every number from the shared report
 * snapshot (PostgreSQL authoritative state) — identical to Reports and PPT.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ application?: string; severity?: string; status?: string; iteration?: string }>;
}) {
  const params = await searchParams;
  const filters = {
    applicationId: params.application && Number(params.application) > 0 ? Number(params.application) : undefined,
    severity: params.severity as never | undefined,
    statusValue: params.status,
    iterationNumber: params.iteration && Number(params.iteration) > 0 ? Number(params.iteration) : undefined,
  };

  let report = null;
  let dbError: string | null = null;
  try {
    report = await generateDashboardReport(filters);
  } catch (error) {
    dbError = String(error);
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ application: params.application, severity: params.severity, status: params.status, iteration: params.iteration })) {
    if (v) qs.set(k, v);
  }
  const exportFilters = qs.toString();

  return (
    <>
      <PageHeader
        title="DASHBOARD"
        subtitle={report ? `Live authoritative state · generated ${new Date(report.generatedAt).toLocaleString("en-GB")}${filters.applicationId ? " · filtered by application" : ""}` : "Live authoritative state"}
        actions={
          <div className="flex items-center gap-2">
            <ExportPptButton filtersQS={exportFilters} />
            <Link href="/reports" className="inline-flex h-9 items-center rounded-lg bg-card px-4 text-[13px] font-semibold text-ink-2 shadow-sm transition hover:bg-band">
              Reports
            </Link>
          </div>
        }
      />

      <PageBody>
        {dbError ? (
          <DbUnavailableState />
        ) : !report ? (
          <DbUnavailableState />
        ) : (
          <>
            <section aria-label="Programme KPIs" className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <KpiCard label="Applications" number={report.totalApplications} accent="ink" />
              <KpiCard label="Total findings" number={report.totalFindings} accent="accent" />
              <KpiCard label="Pending" number={report.pendingFindings} accent="progress" />
              <KpiCard label="Closed" number={report.closedFindings} accent="good" />
              <KpiCard label="CAR verified" number={report.carVerified} accent="medium" />
            </section>

            {/* Slide-3 layout: doughnut + status side by side; the top-applications
                panel spans the full width and scrolls internally (never stretches
                or overlaps as more data lands). */}
            <section aria-label="Charts" className="mt-6 grid gap-6 lg:grid-cols-2">
              <SeverityDoughnut
                data={[
                  { name: "Critical", value: report.severityBreakdown.critical },
                  { name: "High", value: report.severityBreakdown.high },
                  { name: "Medium", value: report.severityBreakdown.medium },
                  { name: "Low", value: report.severityBreakdown.low },
                  { name: "Info", value: report.severityBreakdown.info },
                ]}
              />
              <StatusBars
                data={[
                  { name: "Open/Pending", value: report.statusBreakdown.open },
                  { name: "Fixed", value: report.statusBreakdown.fixed },
                  { name: "Not Fixed", value: report.statusBreakdown.notFixed },
                  { name: "Reopened", value: report.statusBreakdown.reopened },
                  { name: "CAR", value: report.statusBreakdown.car },
                ]}
              />
            </section>

            <div className="mt-6">
              <ApplicationBars
                title="Applications by findings"
                data={report.applications
                  .filter((a) => a.counts.total > 0)
                  .sort((a, b) => b.counts.total - a.counts.total)
                  .slice(0, 15)
                  .map((a) => ({ name: a.displayName, value: a.counts.total }))}
              />
            </div>
            {report.totalFindings === 0 ? (
              <EmptyState
                className="mt-6"
                title={filters.applicationId ? "No findings in scope for this filter" : "No findings registered yet"}
                hint="Import the PT Tracker workbook or add findings manually; the dashboard updates live."
              />
            ) : null}

            <section aria-label="Application register" className="mt-6">
              <DataTable
                caption="Application-level findings"
                rows={report.applications}
                columns={[
                  {
                    key: "app",
                    header: "Application",
                    render: (a) => (
                      <Link href={`/pt-tracker/${a.id}`} className="font-medium text-progress underline-offset-4 hover:underline">
                        {a.displayName}
                      </Link>
                    ),
                  },
                  { key: "type", header: "Type", render: (a) => a.typeName },
                  { key: "total", header: "Total", render: (a) => <strong>{a.counts.total}</strong> },
                  { key: "crit", header: "Crit", render: (a) => a.counts.critical },
                  { key: "high", header: "High", render: (a) => a.counts.high },
                  { key: "med", header: "Med", render: (a) => a.counts.medium },
                  { key: "low", header: "Low", render: (a) => a.counts.low },
                  { key: "pend", header: "Pending", render: (a) => a.counts.pending },
                  { key: "fixed", header: "Fixed", render: (a) => a.counts.fixed },
                  { key: "nf", header: "Not Fixed", render: (a) => a.counts.notFixed },
                  { key: "ro", header: "Reopened", render: (a) => a.counts.reopened },
                  { key: "car", header: "CAR", render: (a) => a.counts.car },
                  { key: "iter", header: "Iteration", render: (a) => (a.latestIteration ? `I${a.latestIteration}` : "—") },
                ]}
                emptyTitle="No applications in scope"
              />
            </section>

            <section aria-label="Recent activity" className="panel mt-6 px-5 py-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Recent activity</h2>
              <ul className="mt-2 space-y-1 text-[13px]">
                {report.recentActivity.length === 0 ? <li className="text-muted">No recent events.</li> : null}
                {report.recentActivity.map((r, i) => (
                  <li key={i} className="text-ink-2">
                    <span className="text-muted">{new Date(r.at).toLocaleString("en-GB")}</span> — {r.action} ({r.entityType} #{r.entityId})
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}
