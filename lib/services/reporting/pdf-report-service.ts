/**
 * Application PDF reports (user-requested Phase 9.1).
 * Manual uploads of the tester PDF report per application/iteration — the
 * same rules as the EML pipeline: ONLY human uploads, originals stored
 * VERBATIM with sha256, the client-provided MIME name is never trusted
 * (magic bytes are validated server-side), audit on every call.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export const APP_REPORT_MAX_BYTES = Number(process.env.REPORT_PDF_MAX_MB ?? 20) * 1024 * 1024;

/** Storage root for report PDFs (defaults to storage/reports, gitignored). */
export function reportsRoot(): string {
  return path.resolve(process.env.REPORT_STORAGE_ROOT ?? path.join("storage", "reports"));
}

export interface ApplicationReportDTO {
  id: number;
  applicationId: number;
  iterationId: number | null;
  iterationNumber: number | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  uploadedBy: string;
  createdAt: string;
}

type ReportRow = {
  id: number;
  applicationId: number;
  iterationId: number | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt: Date;
  iteration: { number: number } | null;
  createdBy: { displayName: string };
};

function toDTO(row: ReportRow): ApplicationReportDTO {
  return {
    id: row.id,
    applicationId: row.applicationId,
    iterationId: row.iterationId,
    iterationNumber: row.iteration?.number ?? null,
    fileName: row.fileName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    uploadedBy: row.createdBy.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Display-only sanitization: path parts and control characters removed. */
function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "report.pdf";
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "report.pdf";
}

function storedFileName(original: string): string {
  const safe = sanitizeFileName(original).replace(/[^A-Za-z0-9._-]+/g, "_").toLowerCase();
  return `${Date.now()}-${randomBytes(6).toString("hex")}-${safe.slice(0, 60) || "report"}.pdf`;
}

async function verifyIterationBelongsToApplication(applicationId: number, iterationId: number): Promise<void> {
  const found = await prisma.iteration.findFirst({ where: { id: iterationId, engagement: { applicationId } }, select: { id: true } });
  if (!found) throw ValidationError("Iteration does not belong to this application.");
}

/**
 * §PDF-1 — upload one application report PDF. Guards: size cap, `%PDF-` magic
 * bytes (client MIME never trusted), iteration→application linkage. Original
 * bytes are written verbatim; only the sha256 + path component are stored.
 */
export async function uploadApplicationReport(params: {
  applicationId: number;
  iterationId?: number | null;
  filename: string;
  content: Buffer;
  userId: number;
  ctx: { ip?: string; userAgent?: string };
}): Promise<ApplicationReportDTO> {
  if (!Number.isInteger(params.applicationId) || params.applicationId <= 0) throw ValidationError("applicationId must be a positive integer.");
  const application = await prisma.application.findFirst({ where: { id: params.applicationId, isActive: true }, select: { id: true } });
  if (!application) throw NotFoundError("Application");

  if (typeof params.content !== "object" || params.content.length === 0) throw ValidationError("The uploaded file is empty.");
  if (params.content.length > APP_REPORT_MAX_BYTES) {
    throw ValidationError(`PDF exceeds the upload limit (max ${Math.round(APP_REPORT_MAX_BYTES / 1048576)} MB).`);
  }
  // Magic-byte sniffing: a PDF starts with "%PDF-".
  if (!(params.content.length >= 5 && params.content.subarray(0, 5).toString("latin1") === "%PDF-")) {
    throw ValidationError("Only genuine PDF files are accepted (the file content does not look like a PDF).");
  }
  const fileName = sanitizeFileName(params.filename);

  let iterationId: number | null = null;
  if (typeof params.iterationId === "number" && Number.isInteger(params.iterationId) && params.iterationId > 0) {
    await verifyIterationBelongsToApplication(params.applicationId, params.iterationId);
    iterationId = params.iterationId;
  }

  const sha256 = createHash("sha256").update(params.content).digest("hex");
  const storedName = storedFileName(fileName);
  const root = reportsRoot();
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, storedName), params.content); // verbatim bytes

  try {
    const created = await prisma.applicationReport.create({
      data: {
        applicationId: params.applicationId,
        iterationId,
        fileName,
        storedName,
        mimeType: "application/pdf",
        byteSize: params.content.length,
        sha256,
        uploadedByUserId: params.userId,
      },
      include: { iteration: { select: { number: true } }, createdBy: { select: { displayName: true } } },
    });

    await recordAudit({
      action: "app_report.uploaded",
      entityType: "ApplicationReport",
      entityId: created.id,
      newValue: JSON.stringify({ applicationId: params.applicationId, iterationId, fileName, sha256, byteSize: params.content.length }),
      source: "HUMAN",
      actorUserId: params.userId,
      ip: params.ctx.ip,
      userAgent: params.ctx.userAgent,
      index: { note: "storage path never audited; sha256 only" },
    });
    logger.info("app_report.uploaded", { reportId: created.id, applicationId: params.applicationId, actorUserId: params.userId });
    return toDTO(created);
  } catch (error) {
    // Never leave an orphan file behind when the DB write fails.
    await fs.unlink(path.join(root, storedName)).catch(() => undefined);
    throw error;
  }
}

/** Report list for the Reports screen — storage names never leave the server. */
export async function listApplicationReports(applicationId: number): Promise<ApplicationReportDTO[]> {
  const rows = await prisma.applicationReport.findMany({
    where: { applicationId },
    orderBy: [{ iterationId: "asc" }, { createdAt: "desc" }],
    include: { iteration: { select: { number: true } }, createdBy: { select: { displayName: true } } },
  });
  return rows.map(toDTO) as ApplicationReportDTO[];
}

/** §PDF-2 — download the ORIGINAL bytes captured at upload time. */
export async function readApplicationReportBytes(
  reportId: number,
  auth: { userId: number; ctx: { ip?: string; userAgent?: string } },
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const row = await prisma.applicationReport.findUnique({ where: { id: reportId }, select: { id: true, fileName: true, storedName: true, mimeType: true } });
  if (!row) throw NotFoundError("Application report");
  const bytes = await fs.readFile(path.join(reportsRoot(), row.storedName));
  await recordAudit({
    action: "app_report.downloaded",
    entityType: "ApplicationReport",
    entityId: row.id,
    newValue: JSON.stringify({ fileName: row.fileName }),
    source: "HUMAN",
    actorUserId: auth.userId,
    ip: auth.ctx.ip,
    userAgent: auth.ctx.userAgent,
  });
  return { buffer: bytes, fileName: row.fileName, mimeType: row.mimeType };
}

/** §PDF-3 — deletion requires superuser (route-level guard re-checks here). */
export async function deleteApplicationReport(
  reportId: number,
  auth: { userId: number; isSuperuser: boolean; ctx: { ip?: string; userAgent?: string } },
): Promise<void> {
  if (!auth.isSuperuser) throw ValidationError("Only a superuser may delete uploaded reports.");
  const row = await prisma.applicationReport.findUnique({ where: { id: reportId }, select: { id: true, fileName: true, storedName: true, applicationId: true } });
  if (!row) throw NotFoundError("Application report");
  const result = await prisma.applicationReport.delete({ where: { id: reportId } });
  await fs.unlink(path.join(reportsRoot(), row.storedName)).catch(() => undefined);
  await recordAudit({
    action: "app_report.deleted",
    entityType: "ApplicationReport",
    entityId: reportId,
    oldValue: JSON.stringify({ fileName: row.fileName }),
    newValue: null,
    source: "HUMAN",
    actorUserId: auth.userId,
    ip: auth.ctx.ip,
    userAgent: auth.ctx.userAgent,
  });
  void result;
  logger.info("app_report.deleted", { reportId, applicationId: row.applicationId, actorUserId: auth.userId });
}
