import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma client per process (Next.js hot-reload safe).
 * All database access flows through the service layer — never call this from UI.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
