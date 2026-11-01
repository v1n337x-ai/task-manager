import type { Metadata } from "next";
import { PageHeader, PageBody } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { formatDate } from "@/lib/utils";
import { listSchemaVersions, listImportJobs, listExportJobs } from "@/lib/services/job-foundation-service";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (brief section 13): structure with truthful "Coming in Phase N"
 * states — no fake controls. Real data: schema versions (database contract),
 * import/export job tables (currently empty until Phase 3).
 */
export default async function SettingsPage() {
  let schemas: Awaited<ReturnType<typeof listSchemaVersions>> = [];
  let imports: Awaited<ReturnType<typeof listImportJobs>> = [];
  let exports: Awaited<ReturnType<typeof listExportJobs>> = [];
  let dbError: string | null = null;
  try {
    [schemas, imports, exports] = await Promise.all([listSchemaVersions(), listImportJobs(5), listExportJobs(5)]);
  } catch (error) {
    dbError = String(error);
  }

  return (
    <>
      <PageHeader title="SETTINGS" subtitle="Platform configuration foundations" />

      <PageBody className="space-y-6">
        {dbError ? (
          <section role="alert" className="panel border-l-4 border-l-accent px-5 py-4">
            <p className="text-[13px] font-semibold text-ink">Database unavailable</p>
            <p className="mt-1 text-[13px] text-muted">Settings read their values live; connectivity was not established. Other sections stay in safe placeholder states.</p>
          </section>
        ) : null}

        {/* GENERAL */}
        <section className="panel px-5 py-4" aria-labelledby="s-general">
          <h2 id="s-general" className="text-[13px] font-semibold uppercase tracking-wide text-ink">General</h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-muted">Application</dt>
              <dd className="text-ink-2">Task Manager — VAPT</dd>
            </div>
            <div>
              <dt className="text-muted">Phase</dt>
              <dd className="text-ink-2">2 — Application Foundation &amp; Core Database</dd>
            </div>
            <div>
              <dt className="text-muted">Authentication</dt>
              <dd className="text-ink-2">Single credential (HTTP-only session cookie, 12h)</dd>
            </div>
            <div>
              <dt className="text-muted">Database</dt>
              <dd className="text-ink-2">PostgreSQL 16 · Prisma migrations</dd>
            </div>
          </dl>
        </section>

        {/* DATA SCHEMA */}
        <section className="panel px-5 py-4" aria-labelledby="s-schema">
          <h2 id="s-schema" className="text-[13px] font-semibold uppercase tracking-wide text-ink">Data Schema</h2>
          <p className="mt-1 text-[13px] text-muted">Workbook schema contract for the Phase 3 importer (brief section 37).</p>
          <DataTable
            className="mt-3"
            caption="Tracker schema versions"
            rows={schemas}
            columns={[
              { key: "tracker", header: "Tracker", render: (s) => s.trackerName },
              { key: "version", header: "Version", render: (s) => s.version },
              { key: "columns", header: "Columns", render: (s) => s.columnsCount },
              { key: "notes", header: "Notes", render: (s) => s.notes ?? "—" },
              { key: "created", header: "Registered", render: (s) => formatDate(s.createdAt) },
            ]}
            emptyTitle="No schema versions registered yet"
            emptyHint="Phase 3 registers the PT Tracker 39-column contract on first import."
          />
        </section>

        {/* IMPORT / EXPORT */}
        <section className="panel px-5 py-4" aria-labelledby="s-io">
          <h2 id="s-io" className="text-[13px] font-semibold uppercase tracking-wide text-ink">Import / Export</h2>
          <p className="mt-1 text-[13px] text-muted">Excel round-trip contract activates in Phase 3.</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <DataTable
              className="mt-3"
              caption="Import jobs"
              rows={imports}
              columns={[
                { key: "file", header: "File", render: (j) => j.filename },
                { key: "status", header: "Status", render: (j) => j.statusRef.label },
                { key: "created", header: "Created", render: (j) => formatDate(j.createdAt) },
              ]}
              emptyTitle="No import jobs yet"
              emptyHint="Coming in Phase 3."
            />
            <DataTable
              className="mt-3"
              caption="Export jobs"
              rows={exports}
              columns={[
                { key: "target", header: "Target", render: (j) => j.target.toUpperCase() },
                { key: "status", header: "Status", render: (j) => j.statusRef.label },
                { key: "created", header: "Created", render: (j) => formatDate(j.createdAt) },
              ]}
              emptyTitle="No export jobs yet"
              emptyHint="Excel export — Phase 3. PowerPoint report — Phase 4/5."
            />
          </div>
        </section>

        {/* AI */}
        <section className="panel px-5 py-4" aria-labelledby="s-ai">
          <h2 id="s-ai" className="text-[13px] font-semibold uppercase tracking-wide text-ink">AI</h2>
          <p className="mt-1 text-[13px] text-muted">Extraction records, evidence and human approvals land in Phase 5.</p>
          <p className="mt-2 inline-flex rounded-full bg-band px-3 py-1 text-[12px] font-semibold text-muted">
            Coming in Phase 5
          </p>
        </section>

        {/* EMAIL PROCESSING */}
        <section className="panel px-5 py-4" aria-labelledby="s-email">
          <h2 id="s-email" className="text-[13px] font-semibold uppercase tracking-wide text-ink">Email Processing</h2>
          <p className="mt-1 text-[13px] text-muted">
            EML upload, thread reconstruction and the conversation UI arrive in Phase 6. The database
            foundations (threads, messages, participants, attachments) already exist.
          </p>
          <p className="mt-2 inline-flex rounded-full bg-band px-3 py-1 text-[12px] font-semibold text-muted">
            Coming in Phase 6
          </p>
        </section>

        {/* AUDIT */}
        <section className="panel px-5 py-4" aria-labelledby="s-audit">
          <h2 id="s-audit" className="text-[13px] font-semibold uppercase tracking-wide text-ink">Audit</h2>
          <p className="mt-1 text-[13px] text-muted">
            Every mutation writes an audit row — sources distinguish Human / Excel Import / EML / AI / System
            (brief section 35). The full audit viewer grows in Phase 3+.
          </p>
        </section>

        {/* SYSTEM */}
        <section className="panel px-5 py-4" aria-labelledby="s-system">
          <h2 id="s-system" className="text-[13px] font-semibold uppercase tracking-wide text-ink">System</h2>
          <p className="mt-1 text-[13px] text-muted-2">
            Health probe: <code className="rounded bg-band px-1">GET /api/health</code>. Structured logs emit one
            JSON line per event; secrets are redacted at the logging boundary.
          </p>
        </section>
      </PageBody>
    </>
  );
}
