import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageBody } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/badges";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const metadata: Metadata = { title: "PT Tracker" };

/**
 * PT Tracker (brief section 42): the registry foundation.
 * Full tracker grid, filters, import/export → Phase 3. No fake rows ever.
 */
export default async function PtTrackerPage() {
  let apps: { id: number; displayName: string; typeName: string; envLabel: string; statusLabel: string; links: number }[] = [];
  let error: string | null = null;

  try {
    const rows = await prisma.application.findMany({
      include: { applicationTypeRef: true, environmentRef: true, statusRef: true },
      orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
    });
    apps = rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      typeName: r.applicationTypeRef.label,
      envLabel: r.environmentRef.label,
      statusLabel: r.statusRef.label,
      links: 0,
    }));
  } catch (e) {
    error = String(e);
    logger.error("tracker.page_load_failed", { error });
  }

  return (
    <>
      <PageHeader
        title="PT TRACKER"
        subtitle="Application registry — Phase 3 connects the workbook import/export"
      />

      <PageBody>
        <DataTable
          caption="Application registry"
          rows={error ? null : apps}
          columns={[
            {
              key: "name",
              header: "Application",
              render: (a) => (
                <Link
                  href={`/pt-tracker/${a.id}`}
                  className="font-medium text-progress underline-offset-4 hover:underline"
                >
                  {a.displayName}
                </Link>
              ),
            },
            { key: "type", header: "Type", render: (a) => a.typeName },
            { key: "env", header: "Environment", render: (a) => a.envLabel },
              {
                key: "status",
                header: "Status",
                render: (a) => <StatusBadge value={a.statusLabel.toLowerCase().replace(/ /g, "_")} label={a.statusLabel} />,
              },
          ]}
          loading={false}
          error={error ? "Applications list unavailable" : null}
          emptyTitle="No applications yet"
          emptyHint="Master Data → Applications covers registration; the Phase 3 workbook import fills the operational tracker."
        />

        <div className="panel mt-6 px-5 py-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Coming in Phase 3</h2>
          <p className="mt-1 text-[13px] text-muted-2">
            Findings grid, iteration timeline per application, Excel import/export against the original
            template workbook (39-column fixed contract), severity counts and aging. The detail route for each
            application is already live — open any application above.
          </p>
        </div>
      </PageBody>
    </>
  );
}
