import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { DbUnavailableState } from "@/components/states";
import { SeverityBadge } from "@/components/badges";
import { ExportPptButton } from "../dashboard/export-ppt-button";
import { generateDashboardReport } from "@/lib/services/reporting/report-service";

export const metadata: Metadata = { title: "Reports" };

/**
 * Reports (Phase 7 §14-§16/§44): findings report + application report +
 * iteration report from the SAME snapshot service as the dashboard + PPT.
 */
export default async function ReportsPage({
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
  try {
    report = await generateDashboardReport(filters);
  } catch {
    report = null;
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ application: params.application, severity: params.severity, status: params.status, iteration: params.iteration })) {
    if (v) qs.set(k, v);
  }

  return (
    <>
      <PageHeader
        title="REPORTS"
        subtitle={report ? `Same snapshot as dashboard/PPT · generated ${new Date(report.generatedAt).toLocaleString("en-GB")}` : "Authoritative report views"}
        actions={<ExportPptButton filtersQS={qs.toString()} />}
      />

      <PageBody>
        {!report ? (
          <DbUnavailableState />
        ) : (
          <>
            <section aria-label="Executive KPIs" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KpiCard label="Applications" number={report.totalApplications} accent="ink" />
              <KpiCard label="Total findings" number={report.totalFindings} accent="accent" />
              <KpiCard label="Pending" number={report.pendingFindings} accent="progress" />
              <KpiCard label="Closed" number={report.closedFindings} accent="good" />
            </section>

            <section aria-label="Findings report" className="mt-6">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Findings report</h2>
              <p className="mt-0.5 text-[13px] text-muted">Filter via dashboard URL params (?application= &severity= &status= &iteration=).</p>
              <DataTable
                className="mt-2"
                caption="Findings report"
                rows={report.applications}
                columns={[
                  {
                    key: "app",
                    header: "Application",
                    render: (a) => (
                      <Link href={`/pt-tracker/${a.id}`} className="font-medium text-progress hover:underline">
                        {a.displayName}
                      </Link>
                    ),
                  },
                  { key: "total", header: "Total", render: (a) => <strong>{a.counts.total}</strong> },
                  { key: "crit", header: "Critical", render: (a) => a.counts.critical },
                  { key: "high", header: "High", render: (a) => a.counts.high },
                  { key: "med", header: "Medium", render: (a) => a.counts.medium },
                  { key: "low", header: "Low", render: (a) => a.counts.low },
                  { key: "info", header: "Info", render: (a) => a.counts.info },
                  { key: "open", header: "Open", render: (a) => a.counts.pending },
                  { key: "fixed", header: "Fixed", render: (a) => a.counts.fixed },
                  { key: "nf", header: "Not Fixed", render: (a) => a.counts.notFixed },
                  { key: "re", header: "Reopened", render: (a) => a.counts.reopened },
                  { key: "iter", header: "Current iteration", render: (a) => (a.latestIteration ? `I${a.latestIteration}` : "—") },
                ]}
                emptyTitle="No applications match this scope"
              />
            </section>

            <section aria-label="Iteration report" className="panel mt-6 px-5 py-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Iteration report</h2>
              <ul className="mt-2 flex flex-wrap gap-3 text-[13px]">
                {report.iterationBreakdown.length === 0 ? (
                  <li className="text-muted">No iterations available.</li>
                ) : (
                  report.iterationBreakdown.map((i) => (
                    <li key={i.iteration} className="rounded-lg border border-stroke px-3 py-1.5">
                      <strong>Iteration {i.iteration}</strong> — {i.applications} application(s) at latest
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section aria-label="Severity report" className="panel mt-6 px-5 py-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Severity report</h2>
              <div className="mt-2 flex flex-wrap gap-3">
                <SeverityBadge value="critical" /> <span className="text-[13px]">{report.severityBreakdown.critical}</span>
                <SeverityBadge value="high" /> <span className="text-[13px]">{report.severityBreakdown.high}</span>
                <SeverityBadge value="medium" /> <span className="text-[13px]">{report.severityBreakdown.medium}</span>
                <SeverityBadge value="low" /> <span className="text-[13px]">{report.severityBreakdown.low}</span>
                <SeverityBadge value="info" /> <span className="text-[13px]">{report.severityBreakdown.info}</span>
              </div>
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}
