/**
 * .pst ingestion service (user-directed): EITHER multiple .eml files OR a
 * single .pst feed the SAME pipeline. This service stores the .pst verbatim,
 * mounts it through the machine's Outlook (COM worker script), lists +
 * filters DISTINCT normalized subject lines, and on confirmation re-exports
 * the selected messages as standard .eml files that flow through the
 * untouched .eml pipeline (verbatim originals per message + sha256 audit).
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export const PST_MAX_BYTES = Number(process.env.PST_MAX_SIZE_MB ?? 1024) * 1024 * 1024;
const PST_MAGIC_ANSI = Buffer.from("!BDN", "ascii");

export function pstStorageRoot(): string {
  return path.resolve(process.env.PST_STORAGE_ROOT ?? path.join("storage", "pst"));
}

export interface PstUploadResult {
  jobId: number;
  byteSize: number;
  sha256: string;
  storedAs: string;
}

function hasPstMagic(head: Buffer): boolean {
  return head.length >= 4 && head.subarray(0, 4).equals(PST_MAGIC_ANSI);
}

function sanitize(name: string): string {
  const c = name.split(/[\\/]/).pop() ?? "backup.pst";
  return c.replace(/[\x00-\x1f\x7f]/g, "").trim() || "backup.pst";
}

async function createPstJob(params: { filename: string; storageReference: string; sha256: string; userId: number; applicationId: number | null }): Promise<number> {
  const ready = await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "job_status", value: "ready" } } });
  const job = await prisma.importJob.create({
    data: {
      filename: params.filename,
      mimeType: "application/vnd.microsoft.outlook-pst",
      sha256: params.sha256,
      type: "pst_batch",
      status: ready.id,
      rowsProcessed: 0,
      createdByUserId: params.userId,
      options: { storageReference: params.storageReference, declaredApplicationId: params.applicationId } as never,
    },
  });
  await recordAudit({
    action: "pst_upload.stored",
    entityType: "ImportJob",
    entityId: job.id,
    newValue: JSON.stringify({ filename: params.filename, sha256: params.sha256, path: params.storageReference }),
    source: "HUMAN",
    actorUserId: params.userId,
    index: { note: "pst verbatim lives at user path (locked by Outlook at ingestion time)" },
  });
  return job.id;
}

/** Bytes uploaded through the browser → stored verbatim under storage/pst. */
export async function uploadPst(params: { filename: string; content: Buffer; userId: number; applicationId?: number; ctx: { ip?: string; userAgent?: string } }): Promise<PstUploadResult> {
  if (params.content.length === 0) throw ValidationError("The uploaded .pst file is empty.");
  if (params.content.length > PST_MAX_BYTES) throw ValidationError(`The .pst exceeds the limit (max ${Math.round(PST_MAX_BYTES / 1048576)} MB).`);
  if (!hasPstMagic(params.content.subarray(0, 4))) {
    throw ValidationError("This file is not a recognized PST data file (missing !BDN header).");
  }
  const sha = createHash("sha256").update(params.content).digest("hex");
  const base = sanitize(params.filename);
  const dup = await prisma.importJob.findFirst({ where: { sha256: sha, type: "pst_batch" } });
  if (dup) {
    const ready = await prisma.masterValue.findUniqueOrThrow({ where: { domain_value: { domain: "job_status", value: "ready" } } });
    await prisma.importJob.update({ where: { id: dup.id }, data: { status: ready.id } });
    return { jobId: dup.id, byteSize: params.content.length, sha256: sha, storedAs: dup.filename };
  }
  const root = pstStorageRoot();
  await fs.mkdir(root, { recursive: true });
  const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${base.slice(0, 60)}.pst`;
  await fs.writeFile(path.join(root, stored), params.content);
  const jobId = await createPstJob({ filename: params.filename, storageReference: path.join(root, stored), sha256: sha, userId: params.userId, applicationId: params.applicationId ?? null });
  return { jobId, byteSize: params.content.length, sha256: sha, storedAs: path.join(root, stored) };
}

/**
 * Path-mounted ingestion: the .pst lives on disk (Outlook holds it with an
 * exclusive lock — bytes cannot be copied). The COM worker mounts THAT path,
 * so verbatim preservation stays with the user's file and the sha256 is
 * recorded as path-reference only.
 */
export async function uploadPstByPath(params: { sourcePath: string; applicationId?: number; userId: number; ctx: { ip?: string; userAgent?: string } }): Promise<PstUploadResult> {
  const resolved = path.resolve(params.sourcePath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat) throw ValidationError(`The path does not exist: ${resolved}`);
  if (stat.size > PST_MAX_BYTES) throw ValidationError(`The .pst exceeds the limit (max ${Math.round(PST_MAX_BYTES / 1048576)} MB).`);
  if (!/\.pst$/i.test(resolved)) throw ValidationError("The referenced file is not a .pst.");
  const jobId = await createPstJob({
    filename: path.basename(resolved),
    storageReference: resolved,
    sha256: `path-ref:${resolved.toLowerCase()}`,
    userId: params.userId,
    applicationId: params.applicationId ?? null,
  });
  return { jobId, byteSize: stat.size, sha256: `path-ref:${resolved.toLowerCase()}`, storedAs: resolved };
}

function runPowershell(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("scripts", "pst-export.ps1"), ...args],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) reject(new Error(String(error.message).slice(0, 300)));
        else resolve(String(stdout));
      },
    );
  });
}

export interface PstSubjectEntry {
  key: string; // normalized subject key
  subject: string;
  count: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
  senders: string[];
  vaptFlagged: boolean;
}

const VAPT_RE = /(vapt|vulnerab|penetration|\bblack box\b|retest|\bcve\b|security advisory|\bwaf\b|\baudit\b|\bexploit\b|\bpayload\b|\bseverit)/i;

export async function parsePstSubjects(jobId: number, userId: number, ctx: { ip?: string; userAgent?: string }): Promise<{ subjects: PstSubjectEntry[]; totalMessages: number; warnings: string[] }> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || job.type !== "pst_batch") throw NotFoundError("PST import job");
  const options = (job.options ?? {}) as { storageReference?: string };
  if (!options.storageReference) throw ValidationError("The .pst payload was not found on disk.");

  const stat = await fs.stat(options.storageReference).catch(() => null);
  if (!stat) throw NotFoundError("Stored .pst file (was it moved/deleted?)");

  const outSidecar = path.join(pstStorageRoot(), `meta-${jobId}.json`);
  const stdout = await runPowershell(
    ["-Mode", "metadata", "-PstPath", options.storageReference, "-OutPath", outSidecar],
    30 * 60_000,
  );
  if (!/DONE/.test(stdout)) throw ValidationError(String(stdout).slice(0, 240));
  const raw = await fs.readFile(outSidecar, "utf8");
  const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  const data = JSON.parse(stripBom(raw)) as { total: number; messages: Array<{ subject: string; sentAt: string; fromMail: string; inReplyTo: string; messageId: string }> };

  const warnings: string[] = [];
  const byKey = new Map<string, PstSubjectEntry>();
  const seenIds = new Set<string>();
  for (const m of data.messages) {
    const key = (m.subject ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key) {
      warnings.push("One message skipped: empty subject.");
      continue;
    }
    if (m.messageId && seenIds.has(m.messageId)) continue;
    if (m.messageId) seenIds.add(m.messageId);
    const entry = byKey.get(key) ?? {
      key,
      subject: m.subject,
      count: 0,
      firstSentAt: m.sentAt,
      lastSentAt: m.sentAt,
      senders: [],
      vaptFlagged: VAPT_RE.test(m.subject ?? ""),
    };
    entry.count += 1;
    if (m.sentAt && m.sentAt < (entry.firstSentAt ?? m.sentAt)) entry.firstSentAt = m.sentAt;
    if (m.sentAt && m.sentAt > (entry.lastSentAt ?? m.sentAt)) entry.lastSentAt = m.sentAt;
    const senderLabel = m.fromMail || "unknown";
    if (!entry.senders.includes(senderLabel)) entry.senders.push(senderLabel);
    byKey.set(key, entry);
  }
  const subjects = [...byKey.values()].sort((a, b) => b.count - a.count);
  const preview = { subjects, total: data.total } as never;
  await prisma.importJob.update({
    where: { id: jobId },
    data: { preview, rowsProcessed: data.total },
  });
  await recordAudit({
    action: "pst_parse.subjects",
    entityType: "ImportJob",
    entityId: jobId,
    newValue: JSON.stringify({ subjects: subjects.length, messages: data.total }),
    source: "HUMAN",
    actorUserId: userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  void logger;
  return { subjects, totalMessages: data.total, warnings };
}

export interface PstConfirmResult {
  imported: number;
  skipped: number;
  threads: number[];
  warnings: string[];
}

export async function confirmPstSelection(
  params: { jobId: number; selectedKeys: string[]; userId: number; ctx: { ip?: string; userAgent?: string } },
): Promise<PstConfirmResult> {
  if (!params.selectedKeys.length) throw ValidationError("Select at least one subject to import.");
  const job = await prisma.importJob.findUnique({ where: { id: params.jobId } });
  if (!job || job.type !== "pst_batch") throw NotFoundError("PST import job");
  const options = (job.options ?? {}) as { storageReference?: string };
  if (!options.storageReference) throw NotFoundError("Stored .pst file");

  const tempDir = path.join(pstStorageRoot(), `psttmp-${params.jobId}-${randomBytes(3).toString("hex")}`);
  await fs.mkdir(tempDir, { recursive: true });
  const selectionPath = path.join(tempDir, "selection.json");
  await fs.writeFile(selectionPath, JSON.stringify({ keys: params.selectedKeys.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "")) }), "utf8");

  const exportPath = path.join(tempDir, "export-index.json");
  const stdout = await runPowershell(
    ["-Mode", "export", "-PstPath", options.storageReference, "-OutPath", exportPath, "-SelectionPath", selectionPath, "-TempDir", tempDir],
    120 * 60_000,
  );
  if (!/DONE/.test(stdout)) throw ValidationError(String(stdout).slice(0, 240));
  const rawIndex = await fs.readFile(exportPath, "utf8");
  const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  const index = JSON.parse(stripBom(rawIndex)) as { count: number; files: { subjectKey: string; eml: string }[] };

  const { validateEmlUpload, confirmEmlUpload } = await import("@/lib/eml/email-import-service");
  let imported = 0;
  let skipped = 0;
  const threads = new Set<number>();
  const warnings: string[] = [];
  const declaredApp = (job.options as { declaredApplicationId?: number } | null)?.declaredApplicationId ?? null;
  for (const f of index.files) {
    try {
      const content = await fs.readFile(f.eml);
      const valid = await validateEmlUpload({
        filename: path.basename(f.eml),
        content,
        userId: params.userId,
        applicationId: declaredApp,
        options: { batchId: `pst-${params.jobId}` },
        ctx: {},
      });
      const confirmed = await confirmEmlUpload({ jobId: valid.jobId, userId: params.userId, force: false, ctx: {} });
      threads.add(confirmed.threadId);
      imported++;
    } catch (error) {
      skipped++;
      warnings.push(`${path.basename(f.eml)}: ${String((error as Error).message ?? error).slice(0, 160)}`);
    } finally {
      await fs.unlink(f.eml).catch(() => undefined);
    }
  }
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);

  await recordAudit({
    action: "pst_import.confirmed",
    entityType: "ImportJob",
    entityId: params.jobId,
    newValue: JSON.stringify({ selected: params.selectedKeys.length, imported, skipped, subjects: params.selectedKeys.length }),
    source: "HUMAN",
    actorUserId: params.userId,
    ip: params.ctx.ip,
    userAgent: params.ctx.userAgent,
  });
  return { imported, skipped, threads: [...threads], warnings };
}
