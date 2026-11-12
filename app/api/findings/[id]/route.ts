import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";

/**
 * GET/PATCH /api/findings/[id] (§49/§44).
 * PATCH = set an iteration state; the previous state stays in history (§3 always).
 */
const PatchSchema = z.object({
  iterationId: z.number().int().positive(),
  severityValue: z.enum(["critical", "high", "medium", "low", "info"]),
  statusValue: z.enum(["open", "new", "fixed", "not_fixed", "not_retested", "removed", "out_of_scope", "not_applicable", "unknown", "accepted_risk"]),
  firstSeenAt: z.string().datetime().optional(),
  retestNote: z.string().max(4000).optional(),
  comments: z.string().max(4000).optional(),
  evidenceUrl: z.string().max(500).optional(),
  recommendation: z.string().max(10_000).optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSessionH(request);
    const { id } = await params;
    const findingId = Number(id);
    const finding = await prisma.finding.findUnique({
      where: { id: findingId },
      include: {
        severityRef: true,
        statusRef: true,
        testCase: { select: { code: true } },
        iterationStates: { include: { iteration: { select: { number: true } }, statusRef: true, severityRef: true } },
        history: { orderBy: { createdAt: "asc" }, include: { iteration: { select: { number: true } } } },
      },
    });
    if (!finding) throw NotFoundError("Finding");
    return NextResponse.json({ finding });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSessionH(request);
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const input = PatchSchema.safeParse(body);
    if (!input.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed.",
            details: input.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        },
        { status: 422 },
      );
    }

    const finding = await prisma.finding.findUnique({ where: { id: Number(id) } });
    if (!finding) throw NotFoundError("Finding");

    const { setFindingIterationState } = await import("@/lib/services/finding-service");
    const state = await setFindingIterationState(
      {
        findingId: finding.id,
        iterationId: input.data.iterationId,
        severityValue: input.data.severityValue,
        statusValue: input.data.statusValue,
        firstSeenAt: input.data.firstSeenAt ? new Date(input.data.firstSeenAt) : undefined,
        retestNote: input.data.retestNote ?? input.data.comments ?? null,
        comments: input.data.comments ?? null,
      },
      Number(session.sub),
      { source: "HUMAN", ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined },
    );

    // Optional evidence enrichment on the iteration state (§43 optional fields).
    if (input.data.evidenceUrl || input.data.recommendation) {
      await prisma.findingIterationState.update({
        where: { id: state.id },
        data: {
          evidenceJson: {
            ...(state.evidenceJson as Record<string, unknown> | null),
            ...(input.data.evidenceUrl ? { evidenceUrl: input.data.evidenceUrl } : {}),
            ...(input.data.recommendation ? { recommendation: input.data.recommendation } : {}),
          } as never,
        },
      });
    }

    return NextResponse.json({ state });
  } catch (error) {
    return toErrorResponse(error);
  }
}
