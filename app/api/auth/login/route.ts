import { NextResponse, type NextRequest } from "next/server";
import { LoginSchema } from "@/lib/validation/schemas";
import { authenticate } from "@/lib/services/user-service";
import { signSessionToken, setSessionCookie, getSessionClaims } from "@/lib/auth/session";
import { checkRateLimit, sweepExpiredBuckets } from "@/lib/auth/rate-limit";
import { getEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";
import { headers } from "next/headers";

/**
 * POST /api/auth/login (brief sections 6/8/50).
 * Validates input, enforces per-IP rate limiting, verifies credentials against
 * the bcrypt hash, and issues the HTTP-only session cookie + CSRF token cookie.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "local";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  sweepExpiredBuckets();

  const limit = checkRateLimit(`login:${ip}`, env.LOGIN_RATE_LIMIT_MAX, env.LOGIN_RATE_LIMIT_WINDOW_SECONDS);
  if (!limit.allowed) {
    await recordAudit({ action: "auth.login_rate_limited", entityType: "Auth", source: "SYSTEM", ip, userAgent });
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: `Too many attempts. Try again in ${limit.retryAfterSeconds}s.` } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Malformed JSON body." } },
      { status: 422 },
    );
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid username or password." } },
      { status: 422 },
    );
  }

  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    const token = await signSessionToken({ sub: String(user.id), email: user.email, displayName: user.displayName });
    await setSessionCookie(token);

    await recordAudit({
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      source: "HUMAN",
      actorUserId: user.id,
      ip,
      userAgent,
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHORIZED") {
      const hdrs = await headers();
      void hdrs; // timing equalization not strictly required; generic error returned
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid username or password." } },
        { status: 401 },
      );
    }
    logger.error("auth.login_route_unhandled", { error: String(error) });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Something went wrong. The error has been logged." } },
      { status: 500 },
    );
  }
}

/** GET /api/auth/login — only meaningful when already signed in (session peek). */
export async function GET() {
  const claims = await getSessionClaims();
  if (!claims) return NextResponse.json({ authenticated: false }, { status: 200 });
  return NextResponse.json({ authenticated: true, user: claims });
}

export const dynamic = "force-dynamic";
