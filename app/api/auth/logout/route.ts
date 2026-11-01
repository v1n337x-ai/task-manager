import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";

/** POST /api/auth/logout — clears session + CSRF cookies; audit records the event. */
export async function POST(_request: NextRequest) {
  await clearSessionCookie();
  await recordAudit({ action: "auth.logout", entityType: "Auth", source: "HUMAN" });
  return NextResponse.json({ ok: true });
}
