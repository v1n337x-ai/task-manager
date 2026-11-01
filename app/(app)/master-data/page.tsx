import type { Metadata } from "next";
import { PageHeader, PageBody } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/badges";
import { ApplicationDialogs } from "@/app/(app)/master-data/application-dialogs";
import { MasterValuesSection } from "@/app/(app)/master-data/master-values-section";
import { listApplications } from "@/lib/services/application-service";
import { listAll } from "@/lib/services/master-data-service";

export const metadata: Metadata = { title: "Master Data" };

/**
 * Master Data (brief sections 14-17, 56 docs).
 * Applications CRUD + aliases from the DATABASE master values — no hardcoded
 * vocabulary in components.
 */
export default async function MasterDataPage() {
  const [applications, masterValues] = await Promise.all([
    listApplications().catch(() => null as never),
    listAll().catch(() => [] as never),
  ]);

  return (
    <>
      <PageHeader
        title="MASTER DATA"
        subtitle="Controlled values & application registry"
        actions={<ApplicationDialogs masterValues={masterValues} />}
      />

      <PageBody className="space-y-6">
        <section aria-labelledby="md-apps" className="space-y-3">
          <h2 id="md-apps" className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted">
            Applications
          </h2>
          <DataTable
            caption="Applications registry"
            rows={applications}
            loading={!applications}
            columns={[
              { key: "name", header: "Application", render: (a) => <span className="font-medium text-ink">{a.displayName}</span> },
              { key: "type", header: "Type", render: (a) => a.typeName },
              { key: "scope", header: "Scope", render: (a) => a.scopeLabel },
              { key: "env", header: "Environment", render: (a) => a.environmentLabel },
              { key: "status", header: "Status", render: (a) => <StatusBadge value={a.statusLabel.toLowerCase().replace(/ /g, "_")} label={a.statusLabel} /> },
              { key: "poc", header: "POC", render: (a) => a.primaryPoc?.fullName ?? "—" },
              {
                key: "aliases",
                header: "Aliases",
                render: (a) => (
                  <span className="text-muted">{a.aliases.length === 0 ? "—" : `${a.aliases.length} recorded`}</span>
                ),
              },
              { key: "state", header: "State", render: (a) => (a.isActive ? "Active" : "Inactive") },
            ]}
            emptyTitle="No applications yet"
            emptyHint="Use “New Application” to create the first one. Deactivations preserve history."
          />
        </section>

        <MasterValuesSection masterValues={masterValues} />
      </PageBody>
    </>
  );
}
