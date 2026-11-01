"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginSchema } from "@/lib/validation/schemas";
import { authenticate } from "@/lib/services/user-service";
import { signSessionToken, setSessionCookie } from "@/lib/auth/session";
import { checkRateLimit, sweepExpiredBuckets } from "@/lib/auth/rate-limit";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export interface LoginState {
  error?: string;
}

/**
 * Server action for the login form (brief sections 6-8).
 * Validation → rate limit → credential check → audited session issue.
 * Invalid input/credentials produce one generic message (no user enumeration).
 */
export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const env = getEnv();
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? "local";
  const userAgent = hdrs.get("user-agent") ?? "unknown";
  let authenticatedNextPath = "";

  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  sweepExpiredBuckets();
  const bucketKey = `login:${ip}`;
  const limit = checkRateLimit(bucketKey, env.LOGIN_RATE_LIMIT_MAX, env.LOGIN_RATE_LIMIT_WINDOW_SECONDS);
  if (!limit.allowed) {
    await recordAudit({
      action: "auth.login_rate_limited",
      entityType: "Auth",
      source: "SYSTEM",
      ip,
      userAgent,
    });
    return { error: `Too many attempts. Try again in ${limit.retryAfterSeconds}s.` };
  }

  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    const token = await signSessionToken({
      sub: String(user.id),
      email: user.email,
      displayName: user.displayName,
    });
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
    authenticatedNextPath = String(formData.get("next") ?? "");
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMITED") return { error: error.userMessage };
    if (error instanceof AppError && error.code === "UNAUTHORIZED") {
      await recordAudit({
        action: "auth.login_failed",
        entityType: "Auth",
        source: "SYSTEM",
        ip,
        userAgent,
      });
      return { error: error.userMessage };
    }
    logger.error("auth.login_unhandled", { error: String(error) });
    return { error: "Sign in failed. Please try again." };
  }

  // Redirect AFTER the try/catch — redirect() unwinds via a control-flow error
  // that must never be swallowed.
  redirect(/^\/(dashboard|pt-tracker|reports|settings|master-data)/.test(authenticatedNextPath)
    ? authenticatedNextPath
    : "/dashboard");
}
