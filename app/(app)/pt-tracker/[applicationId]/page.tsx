import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/badges";
import { cn } from "@/lib/utils";
import { StatusFillCell, SeverityFillCell } from "@/components/status-fill";
import { getApplicationTracker, type TrackerFinding, type ApplicationTrackerDetail } from "@/lib/services/tracker-service";
import { listApplications } from "@/lib/services/application-service";
import { listAll } from "@/lib/services/master-data-service";
import { prisma } from "@/lib/db";
import { ExportExcelButton } from "../excel-actions";
import { EmailPanel, type ThreadSummary } from "./email-panel";
import { RowActions } from "../../master-data/application-dialogs";
import { ImportFindingsButton } from "./import-findings-button";
import { StateReviewPanel } from "./state-review-panel";
import {
  FindingDialog,
  IterationDialog,
  FindingStateDialog,
  type IterationLite,
  type TestCaseLite,
} from "../detail-dialogs";
import { AppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Application" };

/**
 * Application detail (§8-§11, §46-§47): Overview / Findings / Iterations /
 * Test Cases / Email / History tabs. Phase 4 adds the Email tab with the
 * .eml pipeline and reconstructed conversations (sanitized rendering only).
 */
export default async function ApplicationTrackerPage({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { applicationId } = await params;
  const { tab } = await searchParams;
  const id = Number(applicationId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let detail: ApplicationTrackerDetail;
  try {
    detail = await getApplicationTracker(id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const activeTab = ["overview", "findings", "iterations", "test-cases", "email", "state-review", "history"].includes(tab ?? "") ? tab! : "overview";
  // Contract cap (user-directed 2026-11): EXACTLY I1 + I2 everywhere. Anything
  // beyond I2 stays stored in the database (append-only) but never reaches the
  // UI or the client payload.
  const iterations: IterationLite[] = detail.iterations
    .filter((i) => i.number <= 2)
    .map((i) => ({ id: i.id, number: i.number, name: i.name }));
  const testCasesLite: TestCaseLite[] = detail.testCases.map((t) => ({ id: t.id, code: t.code, title: t.title }));
  const baseUrl = `/pt-tracker/${id}`;

  const [applicationDto, masterValues] = await Promise.all([
    listApplications()
      .then((list) => list.find((a) => a.id === id) ?? null)
      .catch(() => null),
    listAll().catch(() => []),
  ]);

  const threadRows = await prisma.emailThread.findMany({
    where: { applicationId: id },
    include: { messages: { orderBy: { sentAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });
  const emailThreads: ThreadSummary[] = threadRows.map((t) => ({
    id: t.id,
    subject: t.subject,
    messageCount: t.messages.length,
    lastSentAt: t.messages[0]?.sentAt?.toISOString() ?? null,
  }));

  const statusValueFor = (label: string) => label.toLowerCase().replace(/ /g, "_");

  return (
    <>
      <PageHeader
        title={detail.application.displayName.toUpperCase()}
        subtitle={`${detail.application.typeName} · ${detail.application.scopeLabel} · ${detail.application.environmentLabel} · ${detail.application.statusLabel}${detail.engagement ? ` · ${detail.engagement.assessmentTypeLabel}` : ""}${detail.latestIterationNumber ? ` · latest I${detail.latestIterationNumber}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {applicationDto ? <RowActions application={applicationDto} masterValues={masterValues} /> : null}
            <FindingDialog
              applicationId={id}
              iterations={iterations}
              testCases={testCasesLite}
              latestIterationNumber={detail.latestIterationNumber}
            />
            <IterationDialog applicationId={id} />
            <ExportExcelButton />
            <Link
              href="/pt-tracker"
              className="inline-flex h-9 items-center rounded-none bg-xlsx-band px-4 text-[13px] font-semibold text-ink-2 transition hover:bg-xlsx-data"
            >
              Back to PT Tracker
            </Link>
          </div>
        }
      />

      <PageBody>
        <nav aria-label="Application sections" className="flex flex-wrap gap-2 border-b border-stroke pb-3">
          {([
            ["overview", "Overview"],
            ["findings", "Findings"],
            ["iterations", "Iterations"],
            ["email", "Email"],
            ["state-review", "State Review"],
          ] as [string, string][]).map(([key, label]) => (
            <Link
              key={key}
              href={`${baseUrl}?tab=${key}`}
              aria-current={activeTab === key ? "page" : undefined}
              className={cn(
                "rounded-none px-3.5 py-1.5 text-[13px] font-medium transition",
                activeTab === key ? "bg-accent text-white shadow-sm" : "text-ink-2 hover:bg-accent-soft hover:text-accent-deep",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-5">
          {activeTab === "overview" ? <OverviewTab detail={detail} statusValueFor={statusValueFor} /> : null}
          {activeTab === "findings" ? (
            <div>
              <div className="mb-3">
                <ImportFindingsButton applicationId={id} />
              </div>
              <FindingsTab detail={detail} iterations={iterations} />
            </div>
          ) : null}
          {activeTab === "iterations" ? <IterationsTab detail={detail} /> : null}
          {/* Test Cases tab REMOVED from the UI (user direction 2026-11): TC
              identities live in the backend contract only. */}
          {activeTab === "email" ? (
            <EmailPanel applicationId={id} threads={emailThreads} />
          ) : null}
          {activeTab === "state-review" ? (
            <StateReviewPanel applicationId={id} />
          ) : null}
          {/* History/audit tab REMOVED from the UI (user direction): the
              append-only trail continues in the backend only. Invalid
              ?tab=history falls back to Overview. */}
        </div>
      </PageBody>
    </>
  );
}

function OverviewTab({
  detail,
  statusValueFor,
}: {
  detail: ApplicationTrackerDetail;
  statusValueFor: (label: string) => string;
}) {
  const t = detail.totals;
  return (
    <>
      <section aria-label="Overview KPIs" className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <KpiCard label="Total findings" number={t.total} accent="accent" />
        <KpiCard label="Critical" number={t.critical} accent="critical" />
        <KpiCard label="High" number={t.high} accent="high" />
        <KpiCard label="Medium" number={t.medium} accent="medium" />
        <KpiCard label="Low" number={t.low} accent="low" />
      </section>
      <section aria-label="State KPIs" className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        <KpiCard label="Pending" number={t.pending} accent="progress" />
        <KpiCard label="Fixed" number={t.fixed} accent="good" />
        <KpiCard label="Not Fixed" number={t.notFixed} accent="critical" />
        <KpiCard label="New (latest)" number={t.newInLatestIteration} accent="medium" />
        <KpiCard label="Test cases" number={t.testCases} accent="ink" supporting={`CAR ${t.car}`} />
      </section>

      <dl aria-label="Application overview" className="panel mt-5 grid grid-cols-1 gap-4 px-5 py-4 text-[13px] sm:grid-cols-2">
        <Field label="Application name" value={detail.application.name} />
        <Field label="Display name" value={detail.application.displayName} />
        <Field label="Web URL" value={detail.application.webUrl ?? "—"} />
        <Field label="API / FQDN" value={detail.application.apiFqdn ?? (detail.application.rawTarget ?? "—")} />
        <Field label="Engagement" value={detail.engagement?.name ?? "— (created with the first iteration)"} />
        <Field label="Assessment type" value={detail.engagement?.assessmentTypeLabel ?? "—"} />
        <Field label="Current iteration" value={detail.latestIterationNumber ? `I${detail.latestIterationNumber}` : "—"} />
        <Field
          label="PT status"
          value={<StatusBadge value={statusValueFor(detail.application.statusLabel)} label={detail.application.statusLabel} />}
        />
        <Field label="POC" value={detail.application.primaryPoc ?? "—"} />
        <Field label="Assigned members" value={detail.application.assignedMembers.join(", ") || "—"} />
        <Field label="Aliases" value={detail.application.aliases.map((a) => a.alias).join(", ") || "—"} />
        <Field label="Last updated" value={new Date(detail.application.updatedAt).toLocaleDateString("en-GB")} />
      </dl>
    </>
  );
}

function FindingsTab({
  detail,
  iterations,
}: {
  detail: ApplicationTrackerDetail;
  iterations: IterationLite[];
}) {
  // Uniform contract: only the Iteration 2 column is shown in this table.
  // States beyond I2 remain in the database but are never displayed.
  const visibleIterations = [2];

  // A finding is new in I2 only when it was not repeated in Iteration 1
  // and first appeared in Iteration 2.
  const isNewInIteration2 = (f: TrackerFinding) =>
    f.firstSeenIterationNumber === 2 &&
    f.iterationStates.some((s) => s.iterationNumber === 2) &&
    !f.iterationStates.some((s) => s.iterationNumber === 1);

  // Excel-style layout (vapt.xlsx): # | Name of the vulnerability | Severity
  // | Iteration 2. The Iteration 2 column already shows the current Fixed /
  // Not Fixed / Open verdict, so no duplicate status column.
  const numbered = detail.findings.map((f, i) => ({ f, no: i + 1 }));
  return (
    <DataTable
      className="modern-table"
      caption="Findings summary — vapt.xlsx layout"
      rows={numbered}
      rowClassName={(r: { f: TrackerFinding }) => (isNewInIteration2(r.f) ? "new-i2-row" : undefined)}
      columns={[
        { key: "no", header: "#", className: "w-12 text-center align-middle text-muted", render: (r: { no: number }) => <span className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-accent-soft px-1.5 text-[12px] font-bold text-accent-deep">{r.no}</span> },
        {
          key: "name",
          header: "Name of the vulnerability",
          className: "min-w-[300px] max-w-[420px] align-middle",
          render: (r: { f: TrackerFinding }) => {
            const newInI2 = isNewInIteration2(r.f);
            return (
              <span className="block" title={r.f.description ?? undefined}>
                <span className={newInI2 ? "block text-[14px] font-semibold leading-snug text-green-700" : "block text-[14px] font-semibold leading-snug text-ink"}>
                  {r.f.title}
                </span>
                {newInI2 ? (
                  <span className="mt-1.5 inline-flex items-center rounded-full bg-[#dff2e3] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
                    New in I2
                  </span>
                ) : null}
              </span>
            );
          },
        },
        { key: "severity", header: "Severity", className: "filled-cell w-36 text-center align-middle whitespace-nowrap", render: (r: { f: TrackerFinding }) => <SeverityFillCell severityValue={r.f.severityValue} label={r.f.severityValue.charAt(0).toUpperCase() + r.f.severityValue.slice(1)} /> },
        ...visibleIterations.map((num) => ({
          key: `i${num}`,
          header: `Iteration ${num}`,
          className: "filled-cell w-40 text-center align-middle whitespace-nowrap",
          render: (r: { f: TrackerFinding }) => {
            const state = r.f.iterationStates.find((s) => s.iterationNumber === num);
            if (state) {
              const isNew = state.statusValue === "new" && r.f.iterationStates.length === 1;
              return <StatusFillCell value={isNew ? `New in I${num}` : state.statusLabel} />;
            }
            // Retest projection (analyst-workbook semantics): a finding that was
            // already Fixed before this retest and has NO explicit verdict in
            // this iteration is carried forward as Fixed ("no news = still
            // fixed") — the retest confirmed it without a regression note.
            // Findings with no verdict anywhere stay "—".
            const hasEarlier = r.f.iterationStates.some((s) => s.iterationNumber < num);
            const currentFixed = r.f.currentStatusValue === "fixed";
            if (hasEarlier && currentFixed) return <StatusFillCell value="Fixed" />;
            return <StatusFillCell value="—" />;
          },
        })),
        {
          key: "actions",
          header: "",
          className: "w-16 text-center align-middle",
          render: (r: { f: TrackerFinding }) =>
            iterations.length ? (
              <FindingStateDialog finding={{ id: r.f.id, title: r.f.title, severityValue: r.f.severityValue }} iterations={iterations.filter((i) => i.number <= 2)} />
            ) : null,
        },
      ]}
      emptyTitle="No findings yet"
      emptyHint="Use “Add Finding”. Iteration 2 appears as a column."
    />
  );
}

/**
 * History tab — REMOVED from the UI (user direction 2026-11): the append-only
 * audit trail is recorded exclusively in the backend (audit_logs tables via
 * audited services) and is never surfaced in the web app.
 */

function IterationsTab({
  detail,
}: {
  detail: ApplicationTrackerDetail;
}) {
  // Contract cap: display only I1/I2 (older data stays in the database).
  const visible = detail.iterations.filter((i) => i.number <= 2);
  return (
    <DataTable
      caption="Iterations"
      rows={visible}
      columns={[
        { key: "n", header: "#", render: (i) => <strong>I{i.number}</strong> },
        { key: "name", header: "Name", render: (i) => i.name },
        { key: "type", header: "Type", render: (i) => i.typeLabel },
        { key: "status", header: "Status", className: "filled-cell text-center whitespace-nowrap", render: (i) => <StatusFillCell value={i.statusLabel} /> },
        { key: "start", header: "Start", render: (i) => (i.startDate ? new Date(i.startDate).toLocaleDateString("en-GB") : "—") },
        { key: "report", header: "Report", render: (i) => (i.reportDate ? new Date(i.reportDate).toLocaleDateString("en-GB") : "—") },
        // Imported-snapshot column removed (user direction 2026-11): the raw
        // workbook aggregate stays in the DB for audit, never on screen.
      ]}
      emptyTitle="No iterations yet"
      emptyHint="Iteration 1 is created as “Initial Scan”; retests never overwrite it."
    />
  );
}

// TestCasesTab REMOVED from the UI (user direction 2026-11) - TC data stays in the backend contract.


function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-ink-2">{value}</dd>
    </div>
  );
}
