import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionH, toErrorResponse } from "@/lib/api-helpers";
import { createThread, listThreads, upsertParticipant, overrideParticipantRole } from "@/lib/services/email-foundation-service";
import { EmailThreadSchema, UpsertParticipantSchema } from "@/lib/validation/schemas";
import { ValidationError } from "@/lib/errors";

/** Email foundation endpoints — metadata only (EML ingestion is Phase 6). */
export async function GET(request: NextRequest) {
  try {
    await requireSessionH(request);
    const url = new URL(request.url);
    const applicationId = url.searchParams.get("applicationId");
    const threads = await listThreads(applicationId ? Number(applicationId) : undefined);
    return NextResponse.json({ threads });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = await request.json();
    const input = EmailThreadSchema.parse(body);
    const thread = await createThread({ applicationId: input.applicationId ?? null, subject: input.subject }, Number(session.sub));
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** PUT /api/emails — register participant or human role override (§29/§30). */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSessionH(request);
    const body = await request.json();
    const parsed = UpsertParticipantSchema.safeParse(body);
    if (parsed.success) {
      const participant = await upsertParticipant(parsed.data, Number(session.sub));
      return NextResponse.json({ participant }, { status: 201 });
    }
    const overrideSchema = z.object({
      participantEmail: z.string().email(),
      roleValue: z.enum(["pentester", "developer", "application_owner", "security_team", "management", "other", "unknown"]),
      note: z.string().max(1000).optional(),
    });
    const override = overrideSchema.safeParse(body);
    if (!override.success) throw ValidationError("Provide participant payload or role override payload.");
    await overrideParticipantRole({ ...override.data, overrideByUserId: Number(session.sub) }, Number(session.sub));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
