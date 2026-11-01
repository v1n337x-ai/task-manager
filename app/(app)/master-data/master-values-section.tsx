import { DataTable } from "@/components/data-table";
import type { MasterValueDTO } from "@/lib/services/master-data-service";

/**
 * Controlled master-value registry — DB-backed (brief section 14).
 * Adding/retiring values becomes an admin capability once roles land;
 * Phase 2 displays the seeded state genuinely.
 */
export function MasterValuesSection({ masterValues }: { masterValues: MasterValueDTO[] }) {
  const domains = [...new Set(masterValues.map((m) => m.domain))].sort();

  return (
    <section aria-labelledby="md-vocab" className="space-y-3">
      <h2 id="md-vocab" className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted">
        Controlled vocabularies
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {domains.map((domain) => {
          const rows = masterValues.filter((m) => m.domain === domain && m.isActive);
          return (
            <DataTable
              key={domain}
              caption={`${domain} master values`}
              rows={rows}
              columns={[
                { key: "value", header: "Value key", render: (v) => <code className="text-[12px]">{v.value}</code> },
                { key: "label", header: "Label", render: (v) => v.label },
              ]}
              className="text-[13px]"
            />
          );
        })}
      </div>
    </section>
  );
}
