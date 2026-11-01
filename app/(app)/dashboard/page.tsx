import type { Metadata } from "next";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DbUnavailableState, EmptyState } from "@/components/states";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Dashboard — Phase 2 shows REAL foundation counts from the database
 * (brief section 44: no hardcoded production metrics). Chart widgets arrive in
 * Phase 4; tiles reflect the authenticated single user + master data + entities.
 */
export default async function DashboardPage() {
  let counts: {
    apps: number;
    engagements: number;
    iterations: number;
    findings: number;
    testCases: number;
    threads: number;
    masterValues: number;
  } | null = null;

  try {
    const [apps, engagements, iterations, findings, testCases, threads, masterValues] = await Promise.all([
      prisma.application.count(),
      prisma.engagement.count(),
      prisma.iteration.count(),
      prisma.finding.count(),
      prisma.testCase.count(),
      prisma.emailThread.count(),
      prisma.masterValue.count(),
    ]);
    counts = { apps, engagements, iterations, findings, testCases, threads, masterValues };
  } catch {
    counts = null;
  }

  return (
    <>
      <PageHeader title="DASHBOARD" subtitle="Foundation overview — live counts from the application database" />

      <PageBody>
        {!counts ? (
          <DbUnavailableState />
        ) : (
          <>
            <section aria-label="Platform KPIs" className="grid grid-cols-2 gap-5 lg:grid-cols-4">
              <KpiCard label="Applications" number={counts.apps} accent="ink" supporting="master data registry" />
              <KpiCard label="Engagements" number={counts.engagements} accent="progress" supporting="VAPT scope records" />
              <KpiCard label="Iterations" number={counts.iterations} accent="progress" supporting="across all engagements" />
              <KpiCard label="Findings" number={counts.findings} accent="accent" supporting="registered findings" />
            </section>

            <section aria-label="Foundation KPIs" className="mt-5 grid grid-cols-2 gap-5 lg:grid-cols-4">
              <KpiCard label="Test Cases" number={counts.testCases} accent="good" supporting="stable TC identities" />
              <KpiCard label="Email Threads" number={counts.threads} accent="info" supporting="EML foundation (Phase 6)" />
              <KpiCard label="Master Values" number={counts.masterValues} accent="ink" supporting="controlled vocabularies" />
              <KpiCard label="Sign-in" number="1" accent="good" supporting="single credential phase" />
            </section>

            {counts.apps === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="No applications in the registry yet"
                  hint="Create the first application under Master Data. The Phase 3 Excel import will populate the full estate."
                  className="mt-6"
                />
              </div>
            ) : null}

            <section className="panel mt-6 px-5 py-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Reading the numbers</h2>
              <p className="mt-1 text-[13px] text-muted-2">
                Analytics (status distribution, severity heatmaps, aging, timelines) render live in Phase 4 —
                the Recharts dependency is already installed. This phase proves the data foundation and
                authentication; no numbers above are invented.
              </p>
            </section>
          </>
        )}
      </PageBody>
    </>
  );
}
