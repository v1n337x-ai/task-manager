/**
 * Master data service.
 * The ONLY place business code resolves controlled values — no hardcoded
 * vocabulary in components/APIs (brief sections 14/55).
 */
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { MASTER_DOMAINS, type MasterDomain } from "@/lib/master-data/vocabulary";

export interface MasterValueDTO {
  id: number;
  domain: string;
  value: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
}

export function assertValidDomain(domain: string): asserts domain is MasterDomain {
  if (!(MASTER_DOMAINS as readonly string[]).includes(domain)) {
    throw ValidationError(`Unknown master data domain: ${domain}`);
  }
}

export async function listByDomain(domain: string, includeInactive = false): Promise<MasterValueDTO[]> {
  assertValidDomain(domain);
  const rows = await prisma.masterValue.findMany({
    where: { domain, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    value: r.value,
    label: r.label,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  }));
}

export async function listAll(): Promise<MasterValueDTO[]> {
  const rows = await prisma.masterValue.findMany({
    orderBy: [{ domain: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    domain: r.domain,
    value: r.value,
    label: r.label,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
  }));
}

/** Resolve domain+value (e.g. severity="high") to its id; cacheable helper for services. */
export async function getValueId(domain: string, value: string): Promise<number> {
  assertValidDomain(domain);
  const row = await prisma.masterValue.findUnique({
    where: { domain_value: { domain, value } },
  });
  if (!row) throw NotFoundError(`Master value ${domain}/${value}`);
  return row.id;
}

export async function getValue(domain: string, value: string): Promise<MasterValueDTO> {
  assertValidDomain(domain);
  const row = await prisma.masterValue.findUnique({
    where: { domain_value: { domain, value } },
  });
  if (!row) throw NotFoundError(`Master value ${domain}/${value}`);
  return {
    id: row.id,
    domain: row.domain,
    value: row.value,
    label: row.label,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

export interface DomainMap {
  [domain: string]: Record<string, number>;
}

/** Bulk resolve: domain → { value: id } for seed batching and import pipelines. */
export async function buildDomainMap(): Promise<DomainMap> {
  const rows = await prisma.masterValue.findMany();
  const map: DomainMap = {};
  for (const row of rows) {
    if (!row.isActive) continue;
    if (!map[row.domain]) map[row.domain] = {};
    map[row.domain]![row.value] = row.id;
  }
  return map;
}

export async function toggleValue(id: number, isActive: boolean, actorUserId: number | null): Promise<void> {
  const row = await prisma.masterValue.findUnique({ where: { id } });
  if (!row) throw NotFoundError("Master value");
  const usage = await prisma.masterValue.count({
    where: { domain: row.domain, isActive: true },
  });
  if (usage <= 1 && isActive === false) {
    throw ConflictError("At least one active value must remain in a domain.");
  }
  await prisma.masterValue.update({ where: { id }, data: { isActive } });
  // Audit trail — master data changes are compliance-relevant.
  await prisma.auditLog.create({
    data: {
      actorUserId,
      actorLabel: actorUserId ? null : "system",
      action: "master_value.update_active",
      entityType: "MasterValue",
      entityId: String(id),
      fieldName: "isActive",
      oldValue: String(!isActive),
      newValue: String(isActive),
      source: "HUMAN",
    },
  });
}
