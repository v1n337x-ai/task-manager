import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, PageBody } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { StatusBadge, SeverityBadge } from "@/components/badges";
import { Timeline } from "@/components/timeline";
import { getApplicationTracker, type TrackerFinding, type ApplicationTrackerDetail } from "@/lib/services/tracker-service";
import { prisma } from "@/lib/db";
import { ExportExcelButton } from "../excel-actions";
import { EmailPanel, type ThreadSummary } from "./email-panel";
import { StateReviewPanel } from "./state-review-panel";
import {
  FindingDialog,
  IterationDialog,
  TestCaseDialog,
  FindingStateDialog,
  TestCaseStateDialog,
  type IterationLite,
  type TestCaseLite,
} from "../detail-dialogs";
import { cn } from "@/lib/utils";
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
            <FindingDialog
              applicationId={id}
              iterations={iterations}
              testCases={testCasesLite}
              latestIterationNumber={detail.latestIterationNumber}
            />
            <IterationDialog applicationId={id} />
            <TestCaseDialog applicationId={id} />
            <ExportExcelButton />
            <Link
              href="/pt-tracker"
              className="inline-flex h-9 items-center rounded-lg bg-card px-4 text-[13px] font-semibold text-ink-2 shadow-sm transition hover:bg-band"
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
            ["test-cases", "Test Cases"],
            ["email", "Email"],
            ["state-review", "State Review"],
            ["history", "History"],
          ] as [string, string][]).map(([key, label]) => (
            <Link
              key={key}
              href={`${baseUrl}?tab=${key}`}
              aria-current={activeTab === key ? "page" : undefined}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition",
                activeTab === key ? "bg-accent text-white shadow-sm" : "text-ink-2 hover:bg-accent-soft hover:text-accent-deep",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-5">
          {activeTab === "overview" ? <OverviewTab detail={detail} statusValueFor={statusValueFor} /> : null}
          {activeTab === "findings" ? <FindingsTab detail={detail} iterations={iterations} /> : null}
          {activeTab === "iterations" ? <IterationsTab detail={detail} statusValueFor={statusValueFor} /> : null}
          {activeTab === "test-cases" ? (
            <TestCasesTab detail={detail} iterations={iterations} statusValueFor={statusValueFor} />
          ) : null}
          {activeTab === "email" ? (
            <EmailPanel applicationId={id} threads={emailThreads} />
          ) : null}
          {activeTab === "state-review" ? (
            <StateReviewPanel applicationId={id} />
          ) : null}
          {activeTab === "history" ? (
            <section aria-label="History" className="panel px-5 py-4">
              <Timeline
                entries={detail.history.map((h) => ({
                  at: new Date(h.at).toLocaleString("en-GB"),
                  title: `${h.action} — ${h.entityType}${h.entityId ? ` #${h.entityId}` : ""}`,
                  detail: h.actorLabel ? `${h.actorLabel} · ${h.source}` : h.source,
                  accent: h.source === "SYSTEM" ? ("muted" as const) : ("accent" as const),
                }))}
              />
              {detail.history.length === 0 ? (
                <p className="text-[13px] text-muted">No events recorded yet for this application graph.</p>
              ) : null}
            </section>
          ) : null}
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
  const allIterationsUsed = new Set<number>();
  detail.findings.forEach((f) => f.iterationStates.forEach((s) => allIterationsUsed.add(s.iterationNumber)));
  // Contract: exactly I1 + I2 (user-directed cap) — iteration numbers above 2
  // stay in the database (append-only) but are never displayed.
  const usedIterations = [...allIterationsUsed].sort((a, b) => a - b).filter((n) => n <= 2);

  const currentOf = (f: TrackerFinding): string =>
    f.iterationStates.length
      ? f.iterationStates.reduce((a, b) => (b.iterationNumber > a.iterationNumber ? b : a)).statusValue
      : f.currentStatusValue;

  return (
    <DataTable
      caption="Findings summary"
      rows={detail.findings}
      columns={[
        { key: "code", header: "Finding ID", render: (f: TrackerFinding) => <span className="font-semibold text-ink">{f.code}</span> },
        { key: "tc", header: "Test Case", render: (f) => f.testCaseCode ?? "—" },
        { key: "title", header: "Title", render: (f) => <span title={f.description ?? undefined}>{f.title}</span> },
        { key: "sev", header: "Severity", render: (f) => <SeverityBadge value={f.severityValue} /> },
        ...usedIterations.map((num) => ({
          key: `i${num}`,
          header: `I${num} Status`,
          render: (f: TrackerFinding) => {
            const state = f.iterationStates.find((s) => s.iterationNumber === num);
            if (!state) return <span className="text-muted">—</span>;
            const isNew = state.statusValue === "new" && f.iterationStates.length === 1;
            return (
              <span className="inline-flex flex-col items-center gap-0.5">
                <StatusBadge value={state.statusValue} label={isNew ? `New in I${num}` : state.statusLabel} />
                <span className="text-[10px] text-muted">sev: {state.severityValue}</span>
              </span>
            );
          },
        })),
        { key: "current", header: "Current", render: (f: TrackerFinding) => <StatusBadge value={currentOf(f)} /> },
        {
          key: "firstSeen",
          header: "First Seen",
          render: (f) => (f.firstSeenIterationNumber ? `I${f.firstSeenIterationNumber}` : "—"),
        },
        {
          key: "actions",
          header: "",
          render: (f) =>
            iterations.length ? (
              <FindingStateDialog finding={{ id: f.id, code: f.code, title: f.title, severityValue: f.severityValue }} iterations={iterations.filter((i) => i.number <= 2)} />
            ) : null,
        },
      ]}
      emptyTitle="No findings yet"
      emptyHint="Use “Add Finding”. Per-iteration state columns appear for Iteration 1 and Iteration 2 (the contract's two iterations)."
    />
  );
}

function IterationsTab({
  detail,
  statusValueFor,
}: {
  detail: ApplicationTrackerDetail;
  statusValueFor: (label: string) => string;
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
        { key: "status", header: "Status", render: (i) => <StatusBadge value={statusValueFor(i.statusLabel)} label={i.statusLabel} /> },
        { key: "start", header: "Start", render: (i) => (i.startDate ? new Date(i.startDate).toLocaleDateString("en-GB") : "—") },
        { key: "report", header: "Report", render: (i) => (i.reportDate ? new Date(i.reportDate).toLocaleDateString("en-GB") : "—") },
        {
          key: "snapshot",
          header: "Imported snapshot",
          render: (i) =>
            i.importSnapshot ? (
              <span
                className="text-muted"
                title="Snapshot stores the imported workbook aggregate for audit context — live counts always derive from findings (§36)."
              >
                {JSON.stringify((i.importSnapshot as { counts?: unknown }).counts ?? {}).slice(0, 48)}…
              </span>
            ) : (
              <span className="text-muted">—</span>
            ),
        },
      ]}
      emptyTitle="No iterations yet"
      emptyHint="Iteration 1 is created as “Initial Scan”; retests never overwrite it."
    />
  );
}

function TestCasesTab({
  detail,
  iterations,
  statusValueFor,
}: {
  detail: ApplicationTrackerDetail;
  iterations: IterationLite[];
  statusValueFor: (label: string) => string;
}) {
  return (
    <DataTable
      caption="Test cases with per-iteration states"
      rows={detail.testCases}
      columns={[
        { key: "code", header: "Test Case ID", render: (t) => <span className="font-semibold text-ink">{t.code}</span> },
        { key: "title", header: "Test Case", render: (t) => t.title },
        {
          key: "iters",
          header: "Iteration states",
          render: (t) => (
            <span className="flex flex-wrap gap-1">
              {t.iterations.length === 0 ? <span className="text-muted">not yet run</span> : null}
              {t.iterations.map((s) => (
                <StatusBadge key={s.iterationNumber} value={s.status} label={`I${s.iterationNumber}: ${s.label}`} />
              ))}
            </span>
          ),
        },
        {
          key: "status",
          header: "Current",
          render: (t) => <StatusBadge value={statusValueFor(t.currentStatusLabel)} label={t.currentStatusLabel} />,
        },
        { key: "findings", header: "Findings", render: (t) => detail.findings.filter((f) => f.testCaseId === t.id).length },
        {
          key: "actions",
          header: "",
          render: (t) =>
            iterations.length ? <TestCaseStateDialog testCase={{ id: t.id, code: t.code, title: t.title }} iterations={iterations} /> : null,
        },
      ]}
      emptyTitle="No test cases yet"
      emptyHint="Test cases keep stable TC identities across every iteration — removal is recorded as a state, never a deletion (§22)."
    />
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-ink-2">{value}</dd>
    </div>
  );
}
