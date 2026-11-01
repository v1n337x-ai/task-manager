/**
 * Audit service (brief section 35).
 * Every mutation funnels through recordAudit(); sources distinguish the actuator.
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

export interface AuditInput {
  action: string; // "application.create"
  entityType: string;
  entityId?: string | number | null;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  source?: "HUMAN" | "EXCEL_IMPORT" | "EML" | "AI" | "SYSTEM";
  actorUserId?: number | null;
  actorLabel?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  index?: Prisma.InputJsonValue;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId !== null && input.entityId !== undefined ? String(input.entityId) : null,
        fieldName: input.fieldName ?? null,
        oldValue: input.oldValue !== null && input.oldValue !== undefined ? String(input.oldValue).slice(0, 2000) : null,
        newValue: input.newValue !== null && input.newValue !== undefined ? String(input.newValue).slice(0, 2000) : null,
        source: input.source ?? "HUMAN",
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.index ?? undefined,
      },
    });
  } catch (error) {
    // Audit failure must never silence the business action; it is logged loudly.
    logger.error("audit.write_failed", { action: input.action, error: String(error) });
  }
}
