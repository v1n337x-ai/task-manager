import type { Metadata } from "next";
import { PageHeader, PageBody } from "@/components/page-header";

export const metadata: Metadata = { title: "Reports" };

/**
 * Reports (brief section 51): NOT a Phase 2 deliverable beyond the route shell.
 * Export/comment generation is Phase 4/5; no fake charts or placeholders.
 */
export default async function ReportsPage() {
  return (
    <>
      <PageHeader title="REPORTS" subtitle="Report module shell — sections follow the approved deck order" />

      <PageBody>
        <section className="panel px-5 py-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Coming in Phase 4</h2>
          <p className="mt-2 text-[13px] text-muted-2">
            The reports module will render the eleven approved sections in deck order — Executive Summary,
            Application Register, Status Dashboard, Severity Overview, Findings by Application, Vulnerability
            Heatmap, Internal vs External, Scan Timeline, Remediation Status, Cumulative Findings, Key Insights —
            powered by live SQL views and exportable via the PowerPoint composer (Phase 4/5).
          </p>
        </section>
      </PageBody>
    </>
  );
}
