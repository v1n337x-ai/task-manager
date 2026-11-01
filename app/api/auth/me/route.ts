import { NextResponse } from "next/server";
import { getSessionClaims } from "@/lib/auth/session";
import { toPublicUser } from "@/lib/services/user-service";

/** GET /api/auth/me — session introspection (protected by middleware route list). */
export async function GET() {
  const claims = await getSessionClaims();
  if (!claims) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 });
  }
  const user = await toPublicUser(Number(claims.sub));
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Session user no longer exists." } },
      { status: 401 },
    );
  }
  return NextResponse.json({ user });
}
