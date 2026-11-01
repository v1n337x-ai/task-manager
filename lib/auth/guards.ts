/**
 * Server-side authorization guards (brief sections 8/49).
 * Every server action / route handler calls requireSession() first; UI hiding
 * is never the only protection.
 */
import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, type SessionClaims } from "@/lib/auth/session";
import { getUserById } from "@/lib/services/user-service";
import { AppError, UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** Guards for server actions + server components. */
export async function getSessionClaims(): Promise<SessionClaims | null> {
  const jarOrHeaders = await headers();
  const cookie = jarOrHeaders
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("tm_session="));
  const token = cookie?.split("=").slice(1).join("=");
  if (!token) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionClaims> {
  const claims = await getSessionClaims();
  if (!claims) throw UnauthorizedError();
  const user = await getUserById(Number(claims.sub));
  if (!user || !user.isActive) {
    logger.warn("auth.session_user_missing", { sub: claims.sub });
    throw UnauthorizedError("Session user no longer exists.");
  }
  return claims;
}

/** Standalone route-handler guard verifying the raw token (edge/middleware safe). */
export async function verifyTokenFromRequest(request: NextRequest): Promise<SessionClaims | null> {
  const token = request.cookies.get("tm_session")?.value;
  if (!token) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

/** Standard JSON error mapping (never leaks internals to clients). */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.userMessage, details: error.details ?? null } },
      { status: error.status },
    );
  }
  logger.error("api.unhandled_error", { error: String(error) });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong. The error has been logged." } },
    { status: 500 },
  );
}
