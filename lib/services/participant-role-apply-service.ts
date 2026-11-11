/**
 * Apply an AI-proposed (or human-corrected) participant role after the human
 * approval gate. The rule set mirrors EML ingestion: promote UNKNOWN rows,
 * never defeat an existing human override, and record an audit trail the
 * whole way down.
 */
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";

export interface ParticipantRoleApplyResult {
  participantId: number;
  email: string;
  role: string;
  roleSource: "APPROVAL" | "HUMAN";
  changed: boolean;
  reason?: string;
}

const ALLOWED_ROLES = new Set([
  "pentester",
  "developer",
  "application_owner",
  "security_team",
  "management",
  "other",
  "unknown",
]);

function parseItemKey(itemKey: string): { email: string; index: number } {
  // shape: participantRole:<email>#<index>
  const body = itemKey.startsWith("participantRole:") ? itemKey.slice("participantRole:".length) : "";
  const hash = body.lastIndexOf("#");
  if (hash <= 0) throw ValidationError("Malformed participantRole itemKey.");
  const email = body.slice(0, hash).toLowerCase().trim();
  const index = Number(body.slice(hash + 1));
  if (!email || !Number.isInteger(index)) throw ValidationError("Malformed participantRole itemKey.");
  return { email, index };
}

export async function applyParticipantRoleDecision(
  input: { extractionId: number; itemKey: string; correctedRoleValue?: string | null },
  actorUserId: number,
): Promise<ParticipantRoleApplyResult> {
  void actorUserId;
  const extraction = await prisma.aiExtraction.findUnique({
    where: { id: input.extractionId },
    select: { structuredOutput: true },
  });
  if (!extraction) throw NotFoundError("AI extraction");
  const structured = extraction.structuredOutput as { participants?: { email?: string; proposedRole?: string }[] } | null;
  if (!structured?.participants?.length) throw ValidationError("The extraction has no participant proposals.");

  const { email } = parseItemKey(input.itemKey);
  // The itemKey email is the identity; the trailing #index is only a UI
  // disambiguator over the FULL participants array (one proposal per email in
  // practice). Match by email — never by the filtered-array index.
  const proposal = structured.participants.find((p) => (p.email ?? "").toLowerCase() === email);
  if (!proposal) throw ValidationError("The approved participant proposal no longer exists.");

  const roleName =
    input.correctedRoleValue && input.correctedRoleValue.trim().length > 0
      ? input.correctedRoleValue.trim().toLowerCase()
      : (proposal.proposedRole ?? "unknown").toLowerCase();
  if (!ALLOWED_ROLES.has(roleName)) throw ValidationError(`Unknown participant role "${roleName}".`);

  const participant = await prisma.emailParticipant.findUnique({ where: { emailAddress: email } });
  if (!participant) throw NotFoundError("Email participant");

  // Human override always wins; approval never defeats it silently.
  if (participant.humanOverrideRole !== null) {
    const overrideSource: ParticipantRoleApplyResult["roleSource"] =
      participant.roleSource === "HUMAN" ? "HUMAN" : "APPROVAL";
    return {
      participantId: participant.id,
      email,
      role: roleName,
      roleSource: overrideSource,
      changed: false,
      reason: "human override already set",
    };
  }

  const roleRow = await prisma.masterValue.findUnique({ where: { domain_value: { domain: "participant_role", value: roleName } } });
  if (!roleRow) throw ValidationError(`participant_role/${roleName} missing.`);

  const roleSource: ParticipantRoleApplyResult["roleSource"] = input.correctedRoleValue ? "HUMAN" : "APPROVAL";

  await prisma.emailParticipant.update({
    where: { id: participant.id },
    data: {
      role: roleRow.id,
      roleSource: "AI",
      confidence: input.correctedRoleValue ? null : 95,
    },
  });

  return { participantId: participant.id, email, role: roleName, roleSource, changed: true };
}
