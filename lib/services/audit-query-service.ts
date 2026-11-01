import { prisma } from "@/lib/db";

/** Read-only audit query service (used by API + future Settings audit viewer). */
export async function listAudit(params: { take?: number; source?: string } = {}) {
  const take = params.take ?? 50;
  return prisma.auditLog.findMany({
    where: params.source ? { source: params.source as "HUMAN" | "EXCEL_IMPORT" | "EML" | "AI" | "SYSTEM" } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 200),
    include: { actor: { select: { displayName: true, email: true } } },
  });
}
