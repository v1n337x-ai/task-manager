/**
 * Shared API helpers: session guard for route handlers + standard error mapping.
 * Every protected endpoint calls requireSessionH() — server-side auth is never
 * optional (brief section 49).
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getUserById } from "@/lib/services/user-service";
import { AppError, UnauthorizedError, DatabaseUnavailableError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { ZodError } from "zod";

export interface ApiSession {
  sub: string;
  email: string;
  displayName: string;
}

export async function requireSessionH(request: NextRequest): Promise<ApiSession> {
  const token = request.cookies.get("tm_session")?.value;
  const claims = token ? await verifySessionToken(token).catch(() => null) : null;
  if (!claims) throw UnauthorizedError();
  const user = await getUserById(Number(claims.sub));
  if (!user || !user.isActive) {
    logger.warn("api.session_user_missing", { sub: claims.sub });
    throw UnauthorizedError("Session user no longer exists.");
  }
  return claims;
}

/** Map domain/service errors to JSON responses without leaking internals. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.userMessage, details: error.details ?? null } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed.",
          details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 422 },
    );
  }
  const message = String(error);
  if (message.includes("PrismaClientKnownRequestError")) {
    logger.error("api.prisma_error", { error: message.slice(0, 400) });
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Request conflicts with the current data state." } },
      { status: 409 },
    );
  }
  if (message.includes("Can't reach database server")) {
    logger.error("api.database_unreachable", { error: message.slice(0, 400) });
    return NextResponse.json(
      { error: { code: "DATABASE_UNAVAILABLE", message: DatabaseUnavailableError().userMessage } },
      { status: 503 },
    );
  }
  logger.error("api.unhandled_error", { error: message.slice(0, 600) });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong. The error has been logged." } },
    { status: 500 },
  );
}

export { ValidationError };
