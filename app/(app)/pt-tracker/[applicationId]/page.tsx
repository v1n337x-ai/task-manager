import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, PageBody } from "@/components/page-header";
import { StatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/states";
import { getApplication } from "@/lib/services/application-service";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const metadata: Metadata = { title: "Application" };

/**
 * Application detail route foundation (brief section 42).
 * Overview only; findings/iterations/conversation sections are truthful
 * phase placeholders — no fabricated data.
 */
export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const id = Number(applicationId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let app;
  try {
    app = await getApplication(id);
  } catch (error) {
    logger.warn("application.detail_not_found", { id, error: String(error) });
    notFound();
  }

  const members = await prisma.applicationAssignedMember.findMany({
    where: { applicationId: id, isActive: true },
    include: { contact: true },
  });

  return (
    <>
      <PageHeader
        title={app.displayName.toUpperCase()}
        subtitle={`${app.typeName} · ${app.scopeLabel} · ${app.environmentLabel} · ${app.statusLabel}`}
      />

      <PageBody>
        <section className="panel px-5 py-4" aria-label="Application overview">
          <dl className="grid grid-cols-1 gap-4 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Application name" value={app.name} />
            <Field label="Display name" value={app.displayName} />
            <Field label="Type" value={app.typeName} />
            <Field label="Scope" value={app.scopeLabel} />
            <Field label="Environment" value={app.environmentLabel} />
            <Field label="Status" value={<StatusBadge value={app.statusLabel.toLowerCase().replace(/ /g, "_")} label={app.statusLabel} />} />
            <Field label="Web URL" value={app.webUrl ?? "—"} />
            <Field label="API / FQDN" value={app.apiFqdn ?? "—"} />
            <Field label="POC" value={app.primaryPoc?.fullName ?? "—"} />
            <Field label="Assigned members" value={members.map((m) => m.contact.fullName).join(", ") || "—"} />
            <Field label="Aliases" value={app.aliases.map((a) => a.alias).join(", ") || "—"} />
            <Field label="Registry state" value={app.isActive ? "Active" : "Inactive"} />
          </dl>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <section className="panel px-5 py-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Findings</h2>
            <p className="mt-2 text-[13px] text-muted">Coming in Phase 3</p>
          </section>
          <section className="panel px-5 py-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Iterations</h2>
            <p className="mt-2 text-[13px] text-muted">Coming in Phase 3</p>
          </section>
          <section className="panel px-5 py-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Conversation</h2>
            <p className="mt-2 text-[13px] text-muted">Coming in Phase 6</p>
          </section>
        </div>

        {app.aliases.length === 0 ? (
          <EmptyState
            className="mt-6"
            title="No aliases recorded"
            hint="Aliases enable future EML matching (Cash Portal ≈ CashPortal ≈ cash-portal). Add them under Master Data → Applications → Aliases."
          />
        ) : null}
      </PageBody>
    </>
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
