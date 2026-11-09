/**
 * Master multi-app tracker import — Phase M2: the user's own
 * "PT Tracker 26-27.xlsx" workbook is an AUTHORITATIVE user source
 * (source EXCEL_IMPORT — never AI-fabricated).
 *
 * Non-destructive by design (the permanent history rule):
 *  - data fields (dates, comments, mail subject, follow-ups) are FILLED only
 *    when empty — an existing value is never overwritten;
 *  - classification fields (engagement status / assessment source, iteration
 *    statuses) are updated ONLY when the current value is an auto-provisioned
 *    default ("in_progress", "vapt", "planned"/"pending") — every change
 *    audited;
 *  - contacts/POC are added once (never re-created, never re-assigned);
 *  - aggregate counts become clearly labeled placeholder findings ONLY when
 *    the operator chooses that mode, marked "[Master tracker import ...]";
 *    ANY previous placeholder snapshot on the app blocks re-importing counts
 *    (counts are snapshots, deltas are applied through the detail reports);
 *  - the whole workbook is idempotent via the ImportJob sha256 guard.
 */
import { prisma } from "@/lib/db";
import { ValidationError, ConflictError } from "@/lib/errors";
import { parseMasterTrackerWorkbook, type MasterTrackerRow, type MasterSeverityCounts } from "@/lib/excel/master-tracker-parser";
import { createFinding, setFindingIterationState } from "@/lib/services/finding-service";
import { ensureIterations } from "@/lib/services/finding-import-service";
import { recordAudit } from "@/lib/audit";
import { createHash } from "node:crypto";

export interface MasterImportOptions {
  fileName: string;
  countsMode: "placeholder_findings" | "skip_counts";
}

export interface MasterImportResult {
  sha256: string;
  rowsParsed: number;
  applicationsMatched: number;
  engagementsCreated: number;
  engagementsUpdated: number;
  iterationsUpdated: number;
  aliasesAdded: number;
  contactsCreated: number;
  findingsCreated: number;
  skipped: { application: string; reason: string }[];
  warnings: string[];
}

export const MASTER_IMPORT_MARKER_PREFIX = "[Master tracker import ";

type SevKey = keyof MasterSeverityCounts;
const SEVS: SevKey[] = ["critical", "high", "medium", "low", "info"];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normSmart = (s: string): string => norm(s.replace(/\([^)]*\)/g, " "));

const ENGAGEMENT_STATUS_BY_TEXT: Record<string, string> = {
  "in progress": "in_progress",
  completed: "completed",
  "initiated / walkthrough pending": "initiated",
  "on hold": "on_hold",
  "on-hold": "on_hold",
  pending: "pending",
};

const ITER_STATUS_BY_TEXT: Record<string, string> = {
  "in progress": "in_progress",
  completed: "completed",
  pending: "pending",
  planned: "planned",
  "on hold": "on_hold",
  "on-hold": "on_hold",
};

export async function importMasterTrackerWorkbook(
  params: { fileContent: Buffer; options: MasterImportOptions },
  actorUserId: number,
  ctx: { ip?: string; userAgent?: string },
): Promise<MasterImportResult> {
  const parsed = await parseMasterTrackerWorkbook(params.fileContent);
  const rows = parsed.rows;
  const warnings = [...parsed.warnings];
  const sha256 = createHash("sha256").update(params.fileContent).digest("hex");

  const jobStatusCompleted = (await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "completed" } } }))?.id;
  if (!jobStatusCompleted) throw ValidationError("Job status master values are missing.");

  const prior = await prisma.importJob.findUnique({ where: { sha256 } });
  if (prior && prior.status === jobStatusCompleted) {
    throw ConflictError("This exact workbook was already imported (sha256 idempotency guard).");
  }

  const result: MasterImportResult = {
    sha256,
    rowsParsed: rows.length,
    applicationsMatched: 0,
    engagementsCreated: 0,
    engagementsUpdated: 0,
    iterationsUpdated: 0,
    aliasesAdded: 0,
    contactsCreated: 0,
    findingsCreated: 0,
    skipped: [],
    warnings,
  };

  await prisma.importJob.create({
    data: {
      filename: params.options.fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sha256,
      type: "xlsx_master_tracker",
      status: jobStatusCompleted,
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });

  contactsCreatedRef.count = 0;

  const apps = await prisma.application.findMany({
    select: { id: true, name: true, displayName: true, scope: true, aliases: { select: { alias: true } } },
  });
  try {
  for (const row of rows) {
    const targetApp = matchApplication(row, apps);
    if (!targetApp) {
      result.skipped.push({ application: row.application, reason: "No application matched in the registry." });
      continue;
    }
    result.applicationsMatched += 1;

    // Alias so future imports/emails match whatever the sheet printed.
    if (norm(targetApp.name) !== norm(row.application) && !targetApp.aliases.some((a) => norm(a.alias) === norm(row.application))) {
      try {
        await prisma.applicationAlias.create({
          data: {
            applicationId: targetApp.id,
            alias: row.application,
            normalized: norm(row.application),
            aliasType: (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "alias_type", value: "name" } } })).id,
          },
        });
        result.aliasesAdded += 1;
      } catch { /* concurrent insertion is harmless — the alias exists */ }
    }

    // ---- engagement container (create-if-missing, fill-empty) ----
    let engagement = await prisma.engagement.findFirst({ where: { applicationId: targetApp.id, isActive: true }, orderBy: { id: "asc" } });
    if (!engagement) {
      engagement = await prisma.engagement.create({
        data: {
          applicationId: targetApp.id,
          name: `${targetApp.displayName} VAPT`,
          scope: targetApp.scope,
          assessmentSource: (await resolveSourceValueId(row.sourceTool)) ?? (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "assessment_source", value: "vapt" } } })).id,
          status: (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "engagement_status", value: engagementStatusValue(row.overallStatus) } } })).id,
          requestedDate: row.requestedDate,
          reportDate: row.scanDate,
          mailSubject: row.mailSubject,
          notes: row.comments,
          followUpDate: row.followUpDate,
          followUpResponse: row.followUpResponse,
          sortOrder: row.sNo,
          target: row.target,
        },
      });
      result.engagementsCreated += 1;
    } else {
      const data: Record<string, unknown> = {};
      if (engagement.requestedDate === null && row.requestedDate) data.requestedDate = row.requestedDate;
      if (engagement.reportDate === null && row.scanDate) data.reportDate = row.scanDate;
      if (!engagement.mailSubject && row.mailSubject) data.mailSubject = row.mailSubject;
      if (!engagement.notes && row.comments) data.notes = row.comments;
      if (!engagement.target && row.target) data.target = row.target;
      if (engagement.followUpDate === null && row.followUpDate) data.followUpDate = row.followUpDate;
      if (!engagement.followUpResponse && row.followUpResponse) data.followUpResponse = row.followUpResponse;
      if (engagement.sortOrder === null && row.sNo !== null) data.sortOrder = row.sNo;
      // replace ONLY an auto-provisioned default status with the master's value
      const currentLabel = (await prisma.masterValue.findUnique({ where: { id: engagement.status }, select: { value: true } }))?.value;
      const wantedStatus = engagementStatusValue(row.overallStatus);
      if (row.overallStatus && currentLabel === "in_progress" && wantedStatus !== currentLabel) {
        data.status = (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "engagement_status", value: wantedStatus } } })).id;
      }
      if (Object.keys(data).length > 0) {
        await prisma.engagement.update({ where: { id: engagement.id }, data });
        result.engagementsUpdated += 1;
      }
    }
    const engagementId = engagement.id;

    // classification look-around (created engagements carry their values already)
    const currentEng = await prisma.engagement.findUnique({
      where: { id: engagementId },
      select: { statusRef: { select: { value: true } }, sourceRef: { select: { id: true, value: true } } },
    });

    // Assessment source: replace generic auto-provisioned 'vapt' with the exact label.
    if (row.sourceTool) {
      const sourceRow = await resolveSourceValue(row.sourceTool);
      if (sourceRow && currentEng && currentEng.sourceRef.value !== sourceRow.value) {
        await prisma.engagement.update({ where: { id: engagementId }, data: { assessmentSource: sourceRow.id } });
        result.engagementsUpdated += 1;
      } else if (!sourceRow) {
        warnings.push(`${targetApp.displayName}: source/tool "${row.sourceTool}" has no master value — left as-is.`);
      }
    }

    await recordAudit({
      action: "master_tracker.imported",
      entityType: "Application",
      entityId: targetApp.id,
      newValue: JSON.stringify({
        workbook: params.options.fileName,
        sNo: row.sNo,
        engagementId,
        countsMode: params.options.countsMode,
        engagement: result.engagementsCreated + result.engagementsUpdated > 0 ? "touched" : "unchanged",
      }),
      source: "EXCEL_IMPORT",
      actorUserId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    // ---- iterations (I1/I2 dates + statuses) ----
    const { i1, i2 } = await ensureIterations(targetApp.id, actorUserId);
    const patches: { iterationId: number; number: number; startDate?: Date; reportDate?: Date; statusValue?: string }[] = [
      { iterationId: i1, number: 1, startDate: row.iteration1Date ?? undefined, statusValue: iterStatusValue(row.iteration1Status) },
    ];
    if (i2 !== null) patches.push({ iterationId: i2, number: 2, reportDate: row.iteration2Date ?? undefined, statusValue: iterStatusValue(row.iteration2Status) });
    for (const patch of patches) {
      const current = await prisma.iteration.findUnique({ where: { id: patch.iterationId }, select: { startDate: true, reportDate: true, statusRef: { select: { value: true } } } });
      if (!current) continue;
      const data: { startDate?: Date; reportDate?: Date; status?: number } = {};
      if (patch.startDate && current.startDate === null) data.startDate = patch.startDate;
      if (patch.reportDate && current.reportDate === null) data.reportDate = patch.reportDate;
      if (patch.statusValue && ["planned", "pending"].includes(current.statusRef.value)) {
        data.status = (await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "iteration_status", value: patch.statusValue } } })).id;
      }
      if (Object.keys(data).length > 0) {
        await prisma.iteration.update({ where: { id: patch.iterationId }, data });
        result.iterationsUpdated += 1;
      }
    }

    // ---- contacts: POC Task Manager + security-vendor assigned members ----
    for (const person of splitPeople(row.pocText)) {
      const contactId = await ensureContact(person, "Task Manager");
      if (contactId === null) continue;
      const app = await prisma.application.findUnique({ where: { id: targetApp.id }, select: { primaryPocId: true } });
      if (app && app.primaryPocId === null) {
        await prisma.application.update({ where: { id: targetApp.id }, data: { primaryPocId: contactId } });
      }
    }
    for (const person of splitPeople(row.assignedText)) {
      const contactId = await ensureContact(person, "security-vendor (iWeen)");
      if (contactId === null) continue;
      await linkAssignedMember(targetApp.id, contactId);
    }

    // ---- aggregate counts → clearly labeled placeholder findings ----
    if (params.options.countsMode === "placeholder_findings") {
      const existing = await prisma.finding.count({
        where: { applicationId: targetApp.id, description: { contains: MASTER_IMPORT_MARKER_PREFIX } },
      });
      if (existing > 0) {
        warnings.push(`${targetApp.displayName}: ${existing} master-import placeholders already present — counts skipped (snapshot mode, apply deltas via detail reports).`);
        continue;
      }
      // Apps that already carry REAL findings hold the authoritative detail
      // representation of the same snapshot — never aggregate on top of them.
      const realFindings = await prisma.finding.count({ where: { applicationId: targetApp.id } });
      if (realFindings > 0) {
        warnings.push(`${targetApp.displayName}: already carries ${realFindings} real findings — master snapshot counts skipped to avoid double-counting.`);
        continue;
      }
      result.findingsCreated += await createPlaceholderFindings(targetApp.id, row, params.options.fileName, actorUserId, ctx);
    }
  } // end for
  } catch (error) {
    const failedStatus = (await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "failed" } } }))?.id;
    if (failedStatus) {
      await prisma.importJob.update({
        where: { sha256 },
        data: { status: failedStatus, summary: JSON.stringify({ error: String((error as Error).message ?? error).slice(0, 400) }) },
      });
    }
    throw error;
  }

  result.contactsCreated = contactsCreatedRef.count;

  await prisma.importJob.update({
    where: { sha256 },
    data: { summary: JSON.stringify(result), rowsProcessed: result.rowsParsed, warningCount: result.warnings.length },
  });

  await recordAudit({
    action: "master_tracker.import_done",
    entityType: "ImportJob",
    entityId: null,
    newValue: JSON.stringify({ fileName: params.options.fileName, matched: result.applicationsMatched, findingsCreated: result.findingsCreated }),
    source: "EXCEL_IMPORT",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return result;
}

// ---------------------------------------------------------------------------

function matchApplication(
  row: MasterTrackerRow,
  apps: { id: number; name: string; displayName: string; scope: number; aliases: { alias: string }[] }[],
): { id: number; name: string; displayName: string; scope: number; aliases: { alias: string }[] } | null {
  const a = norm(row.application);
  for (const app of apps) {
    if (norm(app.name) === a || norm(app.displayName) === a) return app;
    if (app.aliases.some((al) => norm(al.alias) === a)) return app;
  }
  const b = normSmart(row.application);
  for (const app of apps) {
    if (normSmart(app.name) === b || normSmart(app.displayName) === b) return app;
  }
  return null;
}

async function resolveSourceValue(sourceTool: string): Promise<{ id: number; value: string } | null> {
  const rows = await prisma.masterValue.findMany({ where: { domain: "assessment_source" } });
  const exact = rows.find((m) => m.label.toLowerCase() === sourceTool.toLowerCase());
  if (exact) return { id: exact.id, value: exact.value };
  const loose = rows.find((m) => norm(m.label) === norm(sourceTool));
  if (loose) return { id: loose.id, value: loose.value };
  return null;
}
async function resolveSourceValueId(sourceTool: string | null): Promise<number | null> {
  if (!sourceTool) return null;
  return (await resolveSourceValue(sourceTool))?.id ?? null;
}

function engagementStatusValue(text: string | null): string {
  if (!text) return "in_progress";
  return ENGAGEMENT_STATUS_BY_TEXT[text.toLowerCase()] ?? "pending";
}

function iterStatusValue(text: string | null): string | undefined {
  if (!text) return undefined;
  return ITER_STATUS_BY_TEXT[text.toLowerCase().trim()] ?? undefined;
}

/** Split "Kenneth Fernandes / Adil Khanday" and "Himanshu Kumawat, Rohit Punjabi". */
function splitPeople(text: string | null): string[] {
  if (!text) return [];
  return text.split(/[\/,]/).map((t) => t.trim()).filter((t) => t.length > 1);
}

/**
 * Vendor-recognition tokens observed in contact strings (e.g.
 * "Himanshu Kumawat - Haptik"). A generic install has no roster, so org
 * inference is disabled by default — deploys add their own entries here.
 */
const ORG_TOKENS: [RegExp, string][] = [];

function inferOrg(person: string): { fullName: string; org: string | null } {
  for (const [rx, org] of ORG_TOKENS) {
    if (rx.test(person)) {
      const fullName = person.replace(rx, "").replace(/[-–—:,.(]+$/, "").replace(/^[–—:(]+/, "").replace(/\s+$/, "").trim();
      return { fullName, org };
    }
  }
  return { fullName: person.replace(/[(].*?[)]/g, "").trim() || person.trim(), org: null };
}

async function ensureContact(person: string, defaultOrg: string): Promise<number | null> {
  const parsed = inferOrg(person);
  const fullName = (parsed.fullName || person).replace(/\s+$/, "").trim();
  if (!fullName || /^[^A-Za-z0-9]+$/.test(fullName)) return null;
  const org = parsed.org ?? defaultOrg;
  const existing = await prisma.contact.findUnique({ where: { org_fullName: { org, fullName } } });
  if (existing) return existing.id;
  const created = await prisma.contact.create({ data: { fullName, org } });
  contactsCreatedRef.count += 1;
  await recordAudit({ action: "master_tracker.contact_created", entityType: "Contact", entityId: created.id, newValue: JSON.stringify({ fullName, org }), source: "EXCEL_IMPORT" });
  return created.id;
}

/** Mutation-safe counter shared per import run (not module state). */
const contactsCreatedRef = { count: 0 };

async function linkAssignedMember(applicationId: number, contactId: number): Promise<void> {
  await prisma.applicationAssignedMember.upsert({
    where: { applicationId_contactId: { applicationId, contactId } },
    create: { applicationId, contactId },
    update: { isActive: true },
  });
}

async function createPlaceholderFindings(
  applicationId: number,
  row: MasterTrackerRow,
  fileName: string,
  actorUserId: number,
  ctx: { ip?: string; userAgent?: string },
): Promise<number> {
  const { i1 } = await ensureIterations(applicationId, actorUserId);
  const marker = `${MASTER_IMPORT_MARKER_PREFIX}${fileName}`;
  const description = `${marker} Severity/status imported from sheet 'VAPT tracker', row #${row.sNo ?? "?"} (${row.application}). The named title replaces this placeholder when the application's detail report is imported.`;
  let created = 0;
  const buckets: { token: "open" | "fixed" | "accepted_risk"; label: string; count: (sev: SevKey) => number }[] = [
    { token: "open", label: "Pending", count: (sev) => row.openBySeverity[sev] },
    { token: "fixed", label: "Closed", count: (sev) => row.closedBySeverity[sev] },
    { token: "accepted_risk", label: "CAR", count: (sev) => row.carBySeverity[sev] },
  ];
  for (const sev of SEVS) {
    let idx = 0;
    for (const bucket of buckets) {
      const n = bucket.count(sev);
      const capSev = sev.charAt(0).toUpperCase() + sev.slice(1);
      for (let k = 1; k <= n; k++) {
        idx += 1;
        const finding = await createFinding(
          {
            applicationId,
            title: `Imported vuln (${capSev}, ${bucket.label}) #${idx}`,
            severityValue: sev,
            description,
            currentStatusValue: bucket.token,
            firstSeenIterationNumber: 1,
          },
          actorUserId,
          ctx,
        );
        if (bucket.token !== "accepted_risk") {
          await setFindingIterationState(
            { findingId: finding.id, iterationId: i1, severityValue: sev, statusValue: bucket.token === "open" ? "open" : "fixed" },
            actorUserId,
            { source: "EXCEL_IMPORT" },
          );
        }
        created += 1;
      }
    }
  }
  return created;
}
