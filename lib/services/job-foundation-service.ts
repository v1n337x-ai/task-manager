/**
 * Import / export job foundations (brief section 36).
 * Processors land in Phase 3/5 — Phase 2 provides tracking scaffolding + truthful
 * 501 endpoints, creating no fake processing.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

export function sha256Buffer(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function createImportJob(input: { filename: string; mimeType?: string | null; content: Buffer | string; createdByUserId?: number | null; options?: unknown }) {
  const jobStatus = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "queued" } } });
  if (!jobStatus) throw NotFoundError("job_status master value");
  const row = await prisma.importJob.create({
    data: {
      filename: input.filename, // recorded as metadata only, never a security control
      mimeType: input.mimeType ?? null,
      sha256: sha256Buffer(input.content),
      type: "xlsx_tracker",
      status: jobStatus.id,
      options: (input.options ?? undefined) as never,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  await recordAudit({
    action: "import_job.create",
    entityType: "ImportJob",
    entityId: row.id,
    newValue: JSON.stringify({ filename: input.filename, sha256: row.sha256 }),
    source: "SYSTEM",
    actorUserId: input.createdByUserId ?? null,
  });
  return row;
}

export async function createExportJob(input: { target: "xlsx" | "pptx"; createdByUserId?: number | null; params?: unknown }) {
  const jobStatus = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "job_status", value: "queued" } } });
  if (!jobStatus) throw NotFoundError("job_status master value");
  const row = await prisma.exportJob.create({
    data: {
      target: input.target,
      status: jobStatus.id,
      params: (input.params ?? undefined) as never,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return row;
}

export async function listImportJobs(take = 20) {
  return prisma.importJob.findMany({ orderBy: { createdAt: "desc" }, take, include: { statusRef: true, createdBy: true } });
}

export async function listExportJobs(take = 20) {
  return prisma.exportJob.findMany({ orderBy: { createdAt: "desc" }, take, include: { statusRef: true, createdBy: true } });
}

/** Schema-version contract used by the Phase 3 importer (brief sections 37). */
export async function registerTrackerSchemaVersion(input: {
  version: string;
  columnsCount: number;
  columnMap?: unknown;
  notes?: string | null;
  actorUserId?: number | null;
}) {
  if (input.columnsCount <= 0) throw ValidationError("columnsCount must be positive.");
  const row = await prisma.schemaVersion.upsert({
    where: { trackerName_version: { trackerName: "PT Tracker", version: input.version } },
    create: {
      trackerName: "PT Tracker",
      version: input.version,
      columnsCount: input.columnsCount,
      columnMap: (input.columnMap ?? undefined) as never,
      notes: input.notes ?? null,
    },
    update: {
      columnsCount: input.columnsCount,
      columnMap: (input.columnMap ?? undefined) as never,
      notes: input.notes ?? input.notes ?? null,
    },
  });
  await recordAudit({
    action: "schema_version.register",
    entityType: "SchemaVersion",
    entityId: row.id,
    newValue: JSON.stringify({ version: input.version, columns: input.columnsCount }),
    source: "SYSTEM",
    actorUserId: input.actorUserId ?? null,
  });
  return row;
}

export async function listSchemaVersions() {
  return prisma.schemaVersion.findMany({ orderBy: { createdAt: "desc" } });
}
