import type { Metadata } from "next";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DbUnavailableState } from "@/components/states";
import { SeverityBadge } from "@/components/badges";
import { ApplicationSelector } from "./app-selector";
import { UploadPdfPanel } from "./upload-pdf-panel";
import { listApplications } from "@/lib/services/application-service";
import { generateDashboardReport } from "@/lib/services/reporting/report-service";
import { getApplicationIterationSummaries } from "@/lib/services/reporting/iteration-summaries";
import { listApplicationReports } from "@/lib/services/reporting/pdf-report-service";
import { DataTable } from "@/components/data-table";

export const metadata: Metadata = { title: "Reports" };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "—");

/**
 * Reports (user-requested redesign): NO findings register table. An
 * application DROPDOWN scopes the page; the selected application gets its
 * per-iteration summary (I1, I2, I3 …) with the same Open/Closed semantics as
 * the Excel export plus the manual PDF upload panel. Unselected = programme
 * KPIs + severity mix + dropdown hint.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ application?: string }>;
}) {
  const params = await searchParams;
  const appId = params.application && Number(params.application) > 0 ? Number(params.application) : undefined;

  let apps: Awaited<ReturnType<typeof listApplications>> = [];
  let snapshotErr: string | null = null;
  let selected: Awaited<ReturnType<typeof getApplicationIterationSummaries>> | null = null;
  let reports: Awaited<ReturnType<typeof listApplicationReports>> = [];
  let snapshot: Awaited<ReturnType<typeof generateDashboardReport>> | null = null;

  try {
    apps = await listApplications();
  } catch {
    snapshotErr = "Applications are not reachable right now.";
  }
  if (appId) {
    try {
      selected = await getApplicationIterationSummaries(appId);
      reports = await listApplicationReports(appId);
    } catch {
      selected = null;
      reports = [];
    }
  }
  try {
    snapshot = await generateDashboardReport(appId ? { applicationId: appId } : {});
  } catch {
    snapshot = null;
    snapshotErr = ebookSnapshotMessage();
  }

  const selectedIterationOptions =
    selected?.iterations.map((it) => ({ id: it.iterationId, label: `I${it.iterationNumber} · ${it.name} (${it.statusLabel})` })) ?? [];

  return (
    <>
      <PageHeader
        title="REPORTS"
        subtitle={selected ? `Per-iteration reports for ${selected.application.displayName}` : "Programme overview — select an application for its iteration reports"}
      />

      <PageBody>
        <ApplicationSelector apps={apps.map((a) => ({ id: a.id, displayName: a.displayName }))} current={appId} />

        {!snapshot && snapshotErr ? (
          <DbUnavailableState className="mt-6" />
        ) : !snapshot ? (
          <DbUnavailableState className="mt-6" />
        ) : (
          <>
            <section aria-label="Programme KPIs" className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
              <KpiCard label="Applications" number={snapshot.totalApplications} accent="ink" />
              <KpiCard label="Total findings" number={snapshot.totalFindings} accent="accent" />
              <KpiCard label="Pending" number={snapshot.pendingFindings} accent="progress" />
              <KpiCard label="Closed" number={snapshot.closedFindings} accent="good" />
              <KpiCard label="CAR verified" number={snapshot.carVerified} accent="medium" />
            </section>

            {/* Per-iteration summaries (I1..In) with Excel-identical Open/Closed rollup */}
            {selected && selected.iterations.length > 0 ? (
              <section aria-label="Iteration summaries" className="mt-6">
                <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Iteration summaries</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  {selected.application.typeLabel} · {selected.application.statusLabel}
                  {selected.application.webUrl ? (
                    <>
                      {" · "}
                      <span className="text-muted-2">{selected.application.webUrl}</span>
                    </>
                  ) : null}
                  {" · Open = not yet fixed/closed, Closed = fixed + not fixed + reopened + CAR (Excel semantics)"}
                </p>
                <DataTable
                  className="mt-3"
                  caption="Per-iteration finding rollup"
                  rows={selected.iterations}
                  columns={[
                    { key: "iter", header: "Iteration", className: "text-center whitespace-nowrap", render: (it) => <strong>{`I${it.iterationNumber}`}</strong> },
                    { key: "name", header: "Iteration name", className: "min-w-[150px]", render: (it) => it.name },
                    { key: "type", header: "Type", className: "whitespace-nowrap", render: (it) => it.typeLabel },
                    { key: "status", header: "Status", className: "whitespace-nowrap", render: (it) => it.statusLabel },
                    { key: "dates", header: "Date", className: "whitespace-nowrap", render: (it) => <span className="text-muted text-[12px]">{fmtDate(it.reportDate ?? it.startDate)}</span> },
                    { key: "crit", header: "Crit", className: "text-center", render: (it) => it.counts.critical },
                    { key: "high", header: "High", className: "text-center", render: (it) => it.counts.high },
                    { key: "med", header: "Med", className: "text-center", render: (it) => it.counts.medium },
                    { key: "low", header: "Low", className: "text-center", render: (it) => it.counts.low },
                    { key: "info", header: "Info", className: "text-center", render: (it) => it.counts.info },
                    { key: "total", header: "Total", className: "text-center", render: (it) => <strong>{it.counts.total}</strong> },
                    { key: "open", header: "Open", className: "text-center", render: (it) => it.counts.open },
                    { key: "closed", header: "Closed", className: "text-center", render: (it) => it.counts.closed },
                    { key: "tc", header: "Test cases", className: "text-center", render: (it) => it.testCases },
                  ]}
                  emptyTitle="No iterations for this application"
                />
              </section>
            ) : null}

            {/* Manual per-application PDF report uploads (verbatim-stored originals) */}
            {selected ? (
              <div className="mt-6">
                <UploadPdfPanel applicationId={selected.application.id} iterations={selectedIterationOptions} reports={reports} />
              </div>
            ) : null}

            {/* Severity mix stays available at programme level */}
            <section aria-label="Severity report" className="panel mt-6 px-5 py-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Severity report</h2>
              <div className="mt-2 flex flex-wrap gap-3">
                <SeverityBadge value="critical" /> <span className="text-[13px]">{snapshot.severityBreakdown.critical}</span>
                <SeverityBadge value="high" /> <span className="text-[13px]">{snapshot.severityBreakdown.high}</span>
                <SeverityBadge value="medium" /> <span className="text-[13px]">{snapshot.severityBreakdown.medium}</span>
                <SeverityBadge value="low" /> <span className="text-[13px]">{snapshot.severityBreakdown.low}</span>
                <SeverityBadge value="info" /> <span className="text-[13px]">{snapshot.severityBreakdown.info}</span>
              </div>
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}

function ebookSnapshotMessage(): string {
  return "The report snapshot is temporarily unreachable. Retry — nothing was altered.";
}
