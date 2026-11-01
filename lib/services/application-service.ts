/**
 * Application service (brief sections 15-17, 42).
 * Every write path records audit entries. Alias normalization is deterministic
 * so future EML/AI matching (Phase 5/6) has a stable key.
 */
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

export interface ApplicationDTO {
  id: number;
  name: string;
  displayName: string;
  typeName: string;
  scopeLabel: string;
  environmentLabel: string;
  statusLabel: string;
  isActive: boolean;
  webUrl: string | null;
  apiFqdn: string | null;
  rawTarget: string | null;
  primaryPoc: { id: number; fullName: string } | null;
  aliases: { id: number; alias: string; aliasType: string; aliasTypeLabel: string; normalized: string }[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApplicationInput {
  name: string;
  displayName?: string;
  applicationTypeValue: string;
  scopeValue: string;
  environmentValue: string;
  statusValue?: string;
  webUrl?: string | null;
  apiFqdn?: string | null;
  rawTarget?: string | null;
  primaryPocId?: number | null;
}

/** Deterministic alias normalization for future matching (lowercase, trim, strip slack). */
export function normalizeAlias(alias: string): string {
  return alias.toLowerCase().trim().replace(/\s{2,}/g, " ").replace(/[^\w@.\-/: ]/g, "");
}

function dto(row: Prisma.ApplicationGetPayload<
  { include: { applicationTypeRef: true; scopeRef: true; environmentRef: true; statusRef: true; primaryPoc: true; aliases: { include: { aliasTypeRef: true } } } }
>): ApplicationDTO {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    typeName: row.applicationTypeRef.value,
    scopeLabel: row.scopeRef.label,
    environmentLabel: row.environmentRef.label,
    statusLabel: row.statusRef.label,
    isActive: row.isActive,
    webUrl: row.webUrl,
    apiFqdn: row.apiFqdn,
    rawTarget: row.rawTarget,
    primaryPoc: row.primaryPoc ? { id: row.primaryPoc.id, fullName: row.primaryPoc.fullName } : null,
    aliases: row.aliases.map((a) => ({
      id: a.id,
      alias: a.alias,
      aliasType: a.aliasTypeRef.value,
      aliasTypeLabel: a.aliasTypeRef.label,
      normalized: a.normalized,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const APP_INCLUDE = {
  applicationTypeRef: true,
  scopeRef: true,
  environmentRef: true,
  statusRef: true,
  primaryPoc: true,
  aliases: { include: { aliasTypeRef: true }, orderBy: { isPrimary: "desc" as const } },
} as const;

export async function listApplications(): Promise<ApplicationDTO[]> {
  const rows = await prisma.application.findMany({
    include: APP_INCLUDE,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return rows.map((r) => dto(r as unknown as Prisma.ApplicationGetPayload<{ include: typeof APP_INCLUDE }>));
}

export async function getApplication(id: number): Promise<ApplicationDTO> {
  const row = await prisma.application.findUnique({ where: { id }, include: APP_INCLUDE });
  if (!row) throw NotFoundError("Application");
  return dto(row as unknown as Prisma.ApplicationGetPayload<{ include: typeof APP_INCLUDE }>);
}

export async function createApplication(input: CreateApplicationInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }): Promise<ApplicationDTO> {
  const nameNorm = normalizeAlias(input.name);
  if (!nameNorm) throw ValidationError("Application name is required.");

  const dup = await prisma.application.findFirst({ where: { name: input.name.trim() } });
  if (dup) throw ConflictError(`Application "${input.name}" already exists.`);

  const resolvedType = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "application_type", value: input.applicationTypeValue } },
  });
  const resolvedScope = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "scope", value: input.scopeValue } },
  });
  const resolvedEnv = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "environment", value: input.environmentValue } },
  });
  if (!resolvedType || !resolvedScope || !resolvedEnv) throw ValidationError("Unknown type, scope or environment.");

  const statusValue = input.statusValue ?? "active";
  const resolvedStatus = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "application_status", value: statusValue } },
  });
  if (!resolvedStatus) throw ValidationError("Unknown application status.");

  const row = await prisma.application.create({
    data: {
      name: input.name.trim(),
      displayName: input.displayName?.trim() || input.name.trim(),
      applicationType: resolvedType.id,
      scope: resolvedScope.id,
      environment: resolvedEnv.id,
      site: resolvedStatus.id,
      webUrl: input.webUrl?.trim() || null,
      apiFqdn: input.apiFqdn?.trim() || null,
      rawTarget: input.rawTarget?.trim() || null,
      primaryPocId: input.primaryPocId ?? null,
    },
    include: APP_INCLUDE,
  });

  // Seed the application's own name (+ display name when different) as aliases
  // so future EML/AI matching has a starting point (brief section 16).
  const nameAliasType = await prisma.masterValue.findUniqueOrThrow({
    where: { domain_value: { domain: "alias_type", value: "name" } },
  });
  const seedAliases: { alias: string; normalized: string }[] = [
    { alias: row.name, normalized: nameNorm },
    ...(row.displayName !== row.name ? [{ alias: row.displayName, normalized: normalizeAlias(row.displayName) }] : []),
  ];
  await prisma.applicationAlias.createMany({
    data: seedAliases.map((a, index) => ({
      applicationId: row.id,
      alias: a.alias,
      aliasType: nameAliasType.id,
      normalized: a.normalized,
      isPrimary: index === 0,
      notes: "seeded from application name",
    })),
    skipDuplicates: true,
  });

  // Re-read with full include.
  const created = await prisma.application.findUniqueOrThrow({
    where: { id: row.id },
    include: APP_INCLUDE,
  });

  await recordAudit({
    action: "application.create",
    entityType: "Application",
    entityId: row.id,
    newValue: JSON.stringify({ name: row.name, displayName: row.displayName, environment: resolvedEnv.value }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  logger.info("application.created", { applicationId: row.id, name: row.name, actorUserId });
  return dto(created as unknown as Prisma.ApplicationGetPayload<{ include: typeof APP_INCLUDE }>);
}

export interface UpdateApplicationInput {
  displayName?: string;
  applicationTypeValue?: string;
  scopeValue?: string;
  environmentValue?: string;
  statusValue?: string;
  webUrl?: string | null;
  apiFqdn?: string | null;
  rawTarget?: string | null;
  primaryPocId?: number | null;
  isActive?: boolean;
}

export async function updateApplication(id: number, patch: UpdateApplicationInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }): Promise<ApplicationDTO> {
  const before = await prisma.application.findUnique({ where: { id } });
  if (!before) throw NotFoundError("Application");

  const data: Prisma.ApplicationUncheckedUpdateInput = {};
  const changes: { field: string; oldValue: string; newValue: string }[] = [];

  if (patch.displayName !== undefined && patch.displayName !== before.displayName) {
    data.displayName = patch.displayName.trim();
  }
  if (patch.applicationTypeValue) {
    const v = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "application_type", value: patch.applicationTypeValue } } });
    if (!v) throw ValidationError("Unknown application type.");
    if (v.id !== before.applicationType) data.applicationType = v.id;
  }
  if (patch.scopeValue) {
    const v = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "scope", value: patch.scopeValue } } });
    if (!v) throw ValidationError("Unknown scope value.");
    if (v.id !== before.scope) data.scope = v.id;
  }
  if (patch.environmentValue) {
    const v = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "environment", value: patch.environmentValue } } });
    if (!v) throw ValidationError("Unknown environment value.");
    if (v.id !== before.environment) data.environment = v.id;
  }
  if (patch.statusValue) {
    const v = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "application_status", value: patch.statusValue } } });
    if (!v) throw ValidationError("Unknown application status value.");
    if (v.id !== before.site) data.site = v.id;
  }
  if (patch.webUrl !== undefined) data.webUrl = patch.webUrl?.trim() || null;
  if (patch.apiFqdn !== undefined) data.apiFqdn = patch.apiFqdn?.trim() || null;
  if (patch.rawTarget !== undefined) data.rawTarget = patch.rawTarget?.trim() || null;
  if (patch.primaryPocId !== undefined) data.primaryPocId = patch.primaryPocId;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  const updated = await prisma.application.update({ where: { id }, data, include: APP_INCLUDE });

  // Field-level audit trail.
  const compareFields: [keyof typeof before, string][] = [
    ["displayName", "Name"],
    ["applicationType", "Type"],
    ["scope", "Scope"],
    ["environment", "Environment"],
    ["site", "Status"],
    ["webUrl", "Web URL"],
    ["apiFqdn", "API / FQDN"],
    ["primaryPocId", "POC"],
    ["isActive", "Active"],
  ];
  const beforeRow = before as unknown as Record<string, unknown>;
  const updatedRow = updated as unknown as Record<string, unknown>;
  for (const [key, label] of compareFields) {
    const ov = beforeRow[key];
    const nv = updatedRow[key];
    if (String(ov) !== String(nv)) {
      changes.push({ field: label, oldValue: String(ov ?? ""), newValue: String(nv ?? "") });
    }
  }

  await recordAudit({
    action: patch.isActive === false ? "application.deactivate" : "application.update",
    entityType: "Application",
    entityId: id,
    newValue: changes.length ? JSON.stringify(changes) : undefined,
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return dto(updated as unknown as Prisma.ApplicationGetPayload<{ include: typeof APP_INCLUDE }>);
}

export async function deactivateApplication(id: number, actorUserId: number, ctx: { ip?: string; userAgent?: string }): Promise<ApplicationDTO> {
  return updateApplication(id, { isActive: false }, actorUserId, ctx);
}

export interface AddAliasInput {
  applicationId: number;
  alias: string;
  aliasTypeValue?: string; // default: infer by shape
  isPrimary?: boolean;
  notes?: string | null;
}

/** Alias type inference for future EML/AI matching convenience. */
export function inferAliasType(alias: string): string {
  const a = alias.toLowerCase().trim();
  if (/^https?:\/\//.test(a)) return "url";
  // Android/iOS package identifiers ≥2 dot-separated lowercase labels;
  // a Java-style leading namespace (com./org./in./io.) is a strong signal.
  if (/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(a) && /^(com|org|net|io|in|app|co)\./.test(a)) return "package";
  if (/^[a-z0-9.\-]+\.[a-z]{2,}(\/.*)?$/.test(a) && !a.includes(" ")) return "fqdn";
  return "name";
}

export interface AliasDTO {
  id: number;
  applicationId: number;
  alias: string;
  aliasType: string;
  aliasTypeLabel: string;
  normalized: string;
  isPrimary: boolean;
  notes: string | null;
}

export async function listAliases(applicationId: number): Promise<AliasDTO[]> {
  const rows = await prisma.applicationAlias.findMany({
    where: { applicationId },
    include: { aliasTypeRef: true },
    orderBy: [{ isPrimary: "desc" }, { alias: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.applicationId,
    alias: r.alias,
    aliasType: r.aliasTypeRef.value,
    aliasTypeLabel: r.aliasTypeRef.label,
    normalized: r.normalized,
    isPrimary: r.isPrimary,
    notes: r.notes,
  }));
}

export async function addAlias(input: AddAliasInput, actorUserId: number, ctx: { ip?: string; userAgent?: string }): Promise<AliasDTO> {
  const application = await prisma.application.findUnique({ where: { id: input.applicationId } });
  if (!application) throw NotFoundError("Application");

  const raw = input.alias.trim();
  if (!raw) throw ValidationError("Alias cannot be empty.");
  const normalized = normalizeAlias(raw);
  if (!normalized) throw ValidationError("Alias cannot be empty after normalization.");

  const typeValue = input.aliasTypeValue?.trim() || inferAliasType(raw);
  const typeRow = await prisma.masterValue.findUnique({
    where: { domain_value: { domain: "alias_type", value: typeValue } },
  });
  if (!typeRow) throw ValidationError("Unknown alias type.");

  const dup = await prisma.applicationAlias.findUnique({
    where: { applicationId_normalized: { applicationId: application.id, normalized } },
  });
  if (dup) {
    throw ConflictError(dup.alias.toLowerCase() === normalized
      ? `Alias "${raw}" already exists for this application (identical).`
      : `Alias "${raw}" overlaps existing alias "${dup.alias}".`);
  }

  const row = await prisma.applicationAlias.create({
    data: {
      applicationId: application.id,
      alias: raw,
      aliasType: typeRow.id,
      normalized,
      isPrimary: input.isPrimary ?? false,
      notes: input.notes ?? null,
    },
    include: { aliasTypeRef: true },
  });

  await recordAudit({
    action: "application_alias.create",
    entityType: "ApplicationAlias",
    entityId: row.id,
    newValue: JSON.stringify({ applicationId: application.id, alias: raw, type: typeValue }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return {
    id: row.id,
    applicationId: row.applicationId,
    alias: row.alias,
    aliasType: row.aliasTypeRef.value,
    aliasTypeLabel: row.aliasTypeRef.label,
    normalized: row.normalized,
    isPrimary: row.isPrimary,
    notes: row.notes,
  };
}

export async function removeAlias(aliasId: number, actorUserId: number, ctx: { ip?: string; userAgent?: string }): Promise<void> {
  const row = await prisma.applicationAlias.findUnique({ where: { id: aliasId } });
  if (!row) throw NotFoundError("Alias");
  await prisma.applicationAlias.delete({ where: { id: aliasId } });
  await recordAudit({
    action: "application_alias.delete",
    entityType: "ApplicationAlias",
    entityId: aliasId,
    oldValue: JSON.stringify({ applicationId: row.applicationId, alias: row.alias }),
    source: "HUMAN",
    actorUserId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}
