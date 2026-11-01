/**
 * Edge middleware (brief sections 6/12/49).
 * - Verifies the session JWT signature out the cookie for protected routes.
 * - Unauthenticated page requests → redirect to /login?next=…
 * - Unauthenticated API/AI-endpoint requests → 401 JSON.
 * - Signed-in users are bounced away from /login → /dashboard.
 * - CSRF double-submit check for mutating API calls (header vs cookie token).
 */
import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "tm_session";
const CSRF_COOKIE = "tm_csrf";

const PROTECTED_PREFIXES = ["/dashboard", "/pt-tracker", "/reports", "/settings", "/master-data"];
const PROTECTED_API_PREFIXES = [
  "/api/applications",
  "/api/master-data",
  "/api/settings",
  "/api/iterations",
  "/api/findings",
  "/api/test-cases",
  "/api/emails",
  "/api/email-threads",
  "/api/participants",
  "/api/audit",
  "/api/imports",
  "/api/exports",
  "/api/auth/me",
];
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    await jwtVerify(token, secret, { issuer: "task-manager", audience: "task-manager-app", algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedPage = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Login/logout endpoints and the health probe stay public.
  const isPublicApi =
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/logout") ||
    pathname.startsWith("/api/auth/session-refresh") ||
    pathname.startsWith("/api/health");

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = await verifySession(token);

  // CSRF (double-submit) — mutating requests to protected APIs must echo the cookie.
  if (authed && isProtectedApi && MUTATING_METHODS.has(request.method)) {
    const headerToken = request.headers.get("x-csrf-token");
    const cookieToken = request.cookies.get(CSRF_COOKIE)?.value;
    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "CSRF token missing or invalid." } }, { status: 403 });
    }
  }

  if (pathname === "/login" && authed) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isProtectedPage && !authed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isProtectedApi && !authed && !isPublicApi) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/login", "/dashboard/:path*", "/pt-tracker/:path*", "/reports/:path*", "/settings/:path*", "/master-data/:path*", "/api/:path*"],
};
