import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DbUnavailableState, EmptyState } from "@/components/states";
import { generateDashboardReport } from "@/lib/services/reporting/report-service";
import { SeverityDoughnut, StatusBars, ApplicationBars, CumulativeFindingsChart, ScanTimeline } from "./dashboard-charts";
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

            <section aria-label="Management insights" className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KpiCard
                label="Dated applications"
                number={report.insights.datedApplications}
                accent="accent"
                supporting={
                  report.insights.missingDateApplications
                    ? `${report.insights.missingDateApplications} missing scan/report date`
                    : "All applications have scan/report dates"
                }
              />
              <KpiCard
                label="Request → report"
                number={report.insights.averageRequestedToReportDays === null ? "—" : `${report.insights.averageRequestedToReportDays} days`}
                accent="progress"
                supporting={
                  report.insights.earliestScanDate && report.insights.latestScanDate
                    ? `Earliest ${new Date(report.insights.earliestScanDate).toLocaleDateString("en-GB")} · latest ${new Date(report.insights.latestScanDate).toLocaleDateString("en-GB")}`
                    : "No paired request/report dates"
                }
              />
              <KpiCard
                label="Open remediation"
                number={report.insights.applicationsWithPendingRemediation}
                accent="critical"
                supporting={report.insights.oldestPendingApplication ? `Oldest open: ${report.insights.oldestPendingApplication}` : "No applications have pending findings"}
              />
              <KpiCard
                label="Cumulative findings"
                number={report.cumulativeFindings.at(-1)?.cumulativeFindings ?? report.totalFindings}
                accent="medium"
                supporting={report.cumulativeFindings.at(-1) ? `Through ${report.cumulativeFindings.at(-1)!.label}` : "No dated scans"}
              />
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

            <section aria-label="Scan timeline and cumulative findings" className="mt-6 grid gap-6 xl:grid-cols-2">
              <ScanTimeline
                data={report.applications
                  .filter((a) => a.scanReportDate)
                  .sort((a, b) => new Date(a.scanReportDate!).getTime() - new Date(b.scanReportDate!).getTime())
                  .map((a) => ({
                    name: a.displayName,
                    value: a.counts.total,
                    date: new Date(a.scanReportDate!).toLocaleDateString("en-GB"),
                    status: a.statusLabel,
                  }))}
              />
              <CumulativeFindingsChart data={report.cumulativeFindings} />
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
          </>
        )}
      </PageBody>
    </>
  );
}
