/**
 * User service — the only way any code talks to the users table.
 */
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export interface PublicUser {
  id: number;
  email: string;
  displayName: string;
  isSuperuser: boolean;
}

const toPublic = (u: {
  id: number;
  email: string;
  displayName: string;
  isSuperuser: boolean;
}): PublicUser => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  isSuperuser: u.isSuperuser,
});

export async function getUserById(id: number) {
  return prisma.user.findUnique({ where: { id } });
}

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
}

/**
 * Single-credential login verification.
 * Same generic error for bad email and bad password (no user enumeration).
 */
export async function authenticate(email: string, password: string): Promise<PublicUser> {
  const user = await getUserByEmail(email);
  if (!user || !user.isActive) {
    logger.info("auth.login_rejected", { reason: "no_active_user" });
    throw UnauthorizedError("Invalid username or password.");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    logger.info("auth.login_rejected", { reason: "bad_password" });
    throw UnauthorizedError("Invalid username or password.");
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  logger.info("auth.login_success", { userId: user.id });
  return toPublic(updated);
}

export async function toPublicUser(id: number): Promise<PublicUser | null> {
  const u = await prisma.user.findUnique({ where: { id } });
  return u ? toPublic(u) : null;
}
