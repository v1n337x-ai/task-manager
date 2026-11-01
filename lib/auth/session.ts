/**
 * Session (brief sections 6/8/38): signed JWT (HS256 via jose) in an HTTP-only,
 * SameSite=Lax cookie with Secure flag in production. 12h TTL by default.
 * Documented deviation from the blueprint's NextAuth@5-beta suggestion: a
 * purpose-built session keeps the single-credential scope auditable and
 * dependency-light; the cookie shape/TTL match DL-04 exactly.
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { AppError, UnauthorizedError } from "@/lib/errors";
import { authContext, getEnv, isProduction } from "@/lib/env";

const encoder = new TextEncoder();

async function key() {
  return encoder.encode(getEnv().AUTH_SECRET);
}

export interface SessionClaims {
  sub: string; // user id
  email: string;
  displayName: string;
}

/** Create a signed session token for storage in the HTTP-only cookie. */
export async function signSessionToken(claims: SessionClaims): Promise<string> {
  const ctx = authContext();
  return new SignJWT({ email: claims.email, displayName: claims.displayName })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ctx.issuer)
    .setAudience(ctx.audience)
    .setIssuedAt()
    .setExpirationTime(`${ctx.maxAgeSeconds}s`)
    .sign(await key());
}

/** Verify a signed session token; throws UnauthorizedError when invalid/expired. */
export async function verifySessionToken(token: string): Promise<SessionClaims> {
  try {
    const ctx = authContext();
    const { payload } = await jwtVerify(token, await key(), {
      issuer: ctx.issuer,
      audience: ctx.audience,
      algorithms: ["HS256"],
      clockTolerance: 5,
    });
    if (!payload.sub) throw new Error("missing subject");
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      displayName: String(payload.displayName ?? ""),
    };
  } catch {
    throw UnauthorizedError("Your session has expired. Please sign in again.");
  }
}

const cookieOptions = () => {
  const ctx = authContext();
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: ctx.maxAgeSeconds,
  } as const;
};

/** Persist the session cookie (server actions / route handlers). */
export async function setSessionCookie(token: string): Promise<void> {
  const ctx = authContext();
  const jar = await cookies();
  jar.set(ctx.cookieName, token, cookieOptions());
  // Double-submit CSRF cookie (readable by client scripts on same origin).
  jar.set(ctx.csrfCookieName, cryptoRandomToken(), {
    httpOnly: false,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: ctx.maxAgeSeconds,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const ctx = authContext();
  const jar = await cookies();
  jar.set(ctx.cookieName, "", { ...cookieOptions(), maxAge: 0 });
  jar.set(ctx.csrfCookieName, "", { httpOnly: false, sameSite: "lax", secure: isProduction(), path: "/", maxAge: 0 });
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(authContext().cookieName)?.value ?? null;
}

/** Current claims, or null when signed out / invalid — used by UI and guards. */
export async function getSessionClaims(): Promise<SessionClaims | null> {
  const token = await readSessionToken();
  if (!token) return null;
  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

function cryptoRandomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Session freshness check for feature later phases (returns remaining seconds). */
export function sessionRemainingSeconds(issuedAtMs: number): number {
  return Math.max(0, Math.floor((issuedAtMs + authContext().maxAgeSeconds * 1000 - Date.now()) / 1000));
}

export const assertSessionValidElseThrow = async (): Promise<SessionClaims> => {
  const claims = await getSessionClaims();
  if (!claims) throw new AppError("UNAUTHORIZED", 401, "Sign in required.");
  return claims;
};
