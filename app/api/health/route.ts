import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/health (public) — database connectivity probe (brief section 46).
 * Does not leak internals; returns plain status codes.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch {
    return NextResponse.json({ status: "ok", database: "unavailable" }, { status: 200 });
  }
}
