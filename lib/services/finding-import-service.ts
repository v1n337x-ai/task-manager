/**
 * Finding-list import service (user-requested pipeline completion):
 * turns an analyst workbook (vapt.xlsx shape) into REAL tracker findings —
 * create per row, set the I1 "open" state severity-correctly, honor an
 * explicit Iteration-2 status column, skip duplicates truthfully, and audit
 * the aggregate. This closes the xl → PT Tracker data path for finding rows.
 */
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { parseFindingListWorkbook } from "@/lib/excel/finding-list-parser";
import { createFinding, setFindingIterationState } from "@/lib/services/finding-service";
import { createIteration } from "@/lib/services/engagement-service";

export interface FindingImportResult {
  created: { id: number; code: string; title: string; severity: string }[];
  skipped: { no: number; title: string; reason: string }[];
  warnings: string[];
  totalRows: number;
}

export async function ensureIterations(applicationId: number, actorUserId: number): Promise<{ i1: number; i2: number | null }> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { engagements: { orderBy: { id: "asc" }, take: 1 } },
  });
  if (!app) throw NotFoundError("Application");
  let engagement = app.engagements[0] ?? null;
  if (!engagement) {
    // Structural container creation matches the tracker behavior (audited).
    engagement = await prisma.engagement.create({
      data: {
        applicationId,
        name: `${app.displayName} VAPT`,
        scope: app.scope,
        assessmentSource: (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "assessment_source", value: "vapt" } } })).id,
        status: (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "engagement_status", value: "in_progress" } } })).id,
      },
    });
  }
  const engagementId = engagement.id;
  let i1 = await prisma.iteration.findFirst({ where: { engagementId, number: 1 } });
  if (!i1) {
    i1 = await createIteration({ engagementId, iterationTypeValue: "initial_scan", statusValue: "completed" }, actorUserId, {});
  }
  let i2 = await prisma.iteration.findFirst({ where: { engagementId, number: 2 } });
  if (!i2) {
    try {
      const created = await createIteration({ engagementId, iterationTypeValue: "retest" }, actorUserId, {});
      i2 = { ...created, iterations: undefined } as never;
    } catch {
      i2 = null; // cap reached or concurrent creation — I2 stays optional
    }
  }
  return { i1: i1.id, i2: i2 ? i2.id : null };
}

export async function importFindingList(params: {
  applicationId: number;
  content: Buffer;
  actorUserId: number;
  ctx: { ip?: string; userAgent?: string };
}): Promise<FindingImportResult> {
  const parsed = await parseFindingListWorkbook(params.content);
  const { i1, i2 } = await ensureIterations(params.applicationId, params.actorUserId);

  const created: FindingImportResult["created"] = [];
  const skipped: FindingImportResult["skipped"] = [];

  for (const row of parsed.rows) {
    try {
      const finding = await createFinding(
        { applicationId: params.applicationId, title: row.title, severityValue: row.severity, description: row.description ?? undefined, firstSeenIterationNumber: 1 },
        params.actorUserId,
        {},
      );
      await setFindingIterationState(
        { findingId: finding.id, iterationId: i1, severityValue: row.severity, statusValue: "open" },
        params.actorUserId,
        { source: "EXCEL_IMPORT" },
      );
      if (row.iteration2Status && i2) {
        await setFindingIterationState(
          { findingId: finding.id, iterationId: i2, severityValue: row.severity, statusValue: row.iteration2Status },
          params.actorUserId,
          { source: "EXCEL_IMPORT" },
        );
      }
      created.push({ id: finding.id, code: finding.code, title: finding.title, severity: row.severity });
    } catch (error) {
      const message = String((error as Error).message ?? error);
      skipped.push({
        no: row.no,
        title: row.title,
        reason: /already exists/i.test(message) ? "duplicate of an existing finding" : message.slice(0, 200),
      });
    }
  }

  await recordAudit({
    action: "app_findings.import",
    entityType: "Application",
    entityId: params.applicationId,
    newValue: JSON.stringify({
      sheet: parsed.sheetName,
      totalRows: parsed.rows.length,
      created: created.length,
      skipped: skipped.length,
      warnings: parsed.warnings.length,
    }),
    source: "HUMAN",
    actorUserId: params.actorUserId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });
  logger.info("app_findings.import", { applicationId: params.applicationId, created: created.length, skipped: skipped.length, actorUserId: params.actorUserId });

  return { created, skipped, warnings: parsed.warnings, totalRows: parsed.rows.length };
}
