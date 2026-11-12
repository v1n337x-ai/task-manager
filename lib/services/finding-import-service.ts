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
import { createFinding, setFindingIterationState, buildFindingMatchKey } from "@/lib/services/finding-service";
import { MASTER_PLACEHOLDER_MARKER } from "@/lib/services/finding-placeholder-utils";
import { createIteration } from "@/lib/services/engagement-service";

export interface FindingImportResult {
  created: { id: number; code: string; title: string; severity: string }[];
  updated: { id: number; code: string; title: string; severity: string }[];
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
  const updated: FindingImportResult["updated"] = [];
  const skipped: FindingImportResult["skipped"] = [];
  const placeholders = await prisma.finding.findMany({
    where: { applicationId: params.applicationId, description: { contains: MASTER_PLACEHOLDER_MARKER } },
    include: { severityRef: { select: { value: true } }, iterationStates: { include: { statusRef: { select: { value: true } }, iteration: { select: { number: true } } } } },
    orderBy: { id: "asc" },
  });
  const usedPlaceholderIds = new Set<number>();

  for (const row of parsed.rows) {
    try {
      const matchKey = buildFindingMatchKey({ title: row.title });
      const existingFinding = await prisma.finding.findUnique({
        where: { applicationId_matchKey: { applicationId: params.applicationId, matchKey } },
      });

      // Replace synthetic master-import placeholders with the named finding.
      // These placeholder rows were deliberately created to hold aggregate
      // counts only; detail reports provide the real names and must supersede them.
      if (!existingFinding) {
        const placeholder = placeholders.find((p) => {
          if (usedPlaceholderIds.has(p.id)) return false;
          return p.severityRef?.value === row.severity;
        });
        if (placeholder) {
          usedPlaceholderIds.add(placeholder.id);
          const severityRow = await prisma.masterValue.findUnique({
            where: { domain_value: { domain: "severity", value: row.severity } },
          });
          const updates: Record<string, unknown> = { title: row.title.trim(), matchKey, firstSeenIterationNumber: row.firstSeenIterationNumber };
          if (severityRow && placeholder.severity !== severityRow.id) updates.severity = severityRow.id;
          await prisma.finding.update({ where: { id: placeholder.id }, data: updates });
          if (row.iteration2Status && i2) {
            await setFindingIterationState(
              { findingId: placeholder.id, iterationId: i2, severityValue: row.severity, statusValue: row.iteration2Status },
              params.actorUserId,
              { source: "EXCEL_IMPORT" },
            );
          }
          if (row.firstSeenIterationNumber === 2 && i2) {
            await setFindingIterationState(
              { findingId: placeholder.id, iterationId: i2, severityValue: row.severity, statusValue: row.iteration2Status ?? "open" },
              params.actorUserId,
              { source: "EXCEL_IMPORT" },
            );
          }
          updated.push({ id: placeholder.id, code: placeholder.code, title: row.title, severity: row.severity });
          continue;
        }
      }

      if (existingFinding) {
        // Keep the original tracking record, but feed the latest workbook values
        // into each named iteration state. I1 is only touched for sightings that
        // belong to I1; I2 findings are appended to the existing record.
        const severityRow = await prisma.masterValue.findUnique({
          where: { domain_value: { domain: "severity", value: row.severity } },
        });
        const updates: Record<string, unknown> = {};
        if (severityRow && existingFinding.severity !== severityRow.id) updates.severity = severityRow.id;
        if (existingFinding.title.trim() !== row.title.trim()) updates.title = row.title.trim();
        if (!existingFinding.firstSeenIterationNumber) updates.firstSeenIterationNumber = row.firstSeenIterationNumber;
        if (Object.keys(updates).length) await prisma.finding.update({ where: { id: existingFinding.id }, data: updates });

        if (row.firstSeenIterationNumber === 1) {
          await setFindingIterationState(
            { findingId: existingFinding.id, iterationId: i1, severityValue: row.severity, statusValue: "open" },
            params.actorUserId,
            { source: "EXCEL_IMPORT" },
          );
        }
        if (row.iteration2Status && i2) {
          await setFindingIterationState(
            { findingId: existingFinding.id, iterationId: i2, severityValue: row.severity, statusValue: row.iteration2Status },
            params.actorUserId,
            { source: "EXCEL_IMPORT" },
          );
        }
        if (row.firstSeenIterationNumber === 2 && !row.iteration2Status && i2) {
          await setFindingIterationState(
            { findingId: existingFinding.id, iterationId: i2, severityValue: row.severity, statusValue: "open" },
            params.actorUserId,
            { source: "EXCEL_IMPORT" },
          );
        }
        updated.push({ id: existingFinding.id, code: existingFinding.code, title: row.title, severity: row.severity });
        continue;
      }

      const finding = await createFinding(
        {
          applicationId: params.applicationId,
          title: row.title,
          severityValue: row.severity,
          description: row.description ?? undefined,
          firstSeenIterationNumber: row.firstSeenIterationNumber,
        },
        params.actorUserId,
        {},
      );
      if (row.firstSeenIterationNumber === 1) {
        await setFindingIterationState(
          { findingId: finding.id, iterationId: i1, severityValue: row.severity, statusValue: "open" },
          params.actorUserId,
          { source: "EXCEL_IMPORT" },
        );
      }
      // An Iteration-2 annotation travels with the row on FIRST import too —
      // otherwise the upsert refactor's create path silently lost it (the
      // placeholder and existing-finding paths both already apply it).
      if (row.iteration2Status && i2) {
        await setFindingIterationState(
          { findingId: finding.id, iterationId: i2, severityValue: row.severity, statusValue: row.iteration2Status },
          params.actorUserId,
          { source: "EXCEL_IMPORT" },
        );
      }
      if (row.firstSeenIterationNumber === 2 && !row.iteration2Status && i2) {
        await setFindingIterationState(
          { findingId: finding.id, iterationId: i2, severityValue: row.severity, statusValue: "open" },
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
      updated: updated.length,
      skipped: skipped.length,
      warnings: parsed.warnings.length,
    }),
    source: "HUMAN",
    actorUserId: params.actorUserId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });
  logger.info("app_findings.import", { applicationId: params.applicationId, created: created.length, updated: updated.length, skipped: skipped.length, actorUserId: params.actorUserId });

  return { created, updated, skipped, warnings: parsed.warnings, totalRows: parsed.rows.length };
}
