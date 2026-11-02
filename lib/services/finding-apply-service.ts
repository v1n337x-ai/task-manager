/**
 * applyApprovedFinding (Phase 9.1 pipeline completion, user-requested):
 * when a human APPROVES an AI `findingStatus:<idx>` item, the AI candidate is
 * applied to the PT Tracker as a REAL finding + iteration state. Strictly
 * human-gated (this function runs only from recordApprovalDecision approve),
 * so the AI still never mutates VAPT data by itself — the human decision is
 * the authorizing action (decisionSource AI_APPROVED semantics).
 */
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { createFinding, setFindingIterationState } from "@/lib/services/finding-service";

export interface ApplyResult {
  findingId: number;
  code: string;
  created: boolean;
  iterationLabel: string;
}

export async function applyApprovedFinding(
  params: { extractionId: number; itemKey: string },
  actorUserId: number,
  ctx: { source?: "HUMAN" | "EXCEL_IMPORT" | "EML" | "AI" | "SYSTEM" } = { source: "AI" },
): Promise<ApplyResult> {
  void ctx; // reserved for downstream contexts; the audit lives in the caller
  const index = Number.parseInt(params.itemKey.split(":")[1] ?? "", 10);
  if (!Number.isInteger(index)) throw ValidationError("Malformed findingStatus item key.");

  const extraction = await prisma.aiExtraction.findUnique({ where: { id: params.extractionId } });
  if (!extraction) throw ValidationError("AI extraction not found.");
  const structured = (extraction.structuredOutput ?? null) as { findings?: unknown[] } | null;
  const item = structured?.findings?.[index] as
    | {
        title?: unknown;
        severity?: unknown;
        description?: unknown;
        statusSignal?: unknown;
        iterationSignal?: unknown;
      }
    | undefined;
  if (!item) throw ValidationError(`Extraction has no finding item #${index}.`);

  const title = typeof item.title === "string" ? item.title.slice(0, 280) : "";
  if (title.length < 3) throw ValidationError("The approved AI finding has an unusable title.");

  const severityValue = typeof item.severity === "string" ? item.severity : "unknown";
  type Sev = "critical" | "high" | "medium" | "low" | "info";
  const finalSeverity: Sev = (["critical", "high", "medium", "low", "info"].includes(severityValue) ? severityValue : "medium") as Sev;
  const STATUS_UNION = ["fixed", "unknown", "open", "not_fixed", "not_retested", "new", "removed", "out_of_scope", "not_applicable"] as const;
  type StatusV = (typeof STATUS_UNION)[number];
  const statusSignal = typeof item.statusSignal === "string" ? item.statusSignal : "open";
  const statusValue: StatusV = (STATUS_UNION.includes(statusSignal as StatusV) ? (statusSignal as StatusV) : "open");
  const iterationNumber = typeof item.iterationSignal === "number" && item.iterationSignal >= 1 && item.iterationSignal <= 2 ? item.iterationSignal : (statusSignal === "fixed" || statusSignal === "not_fixed" ? 2 : 1);

  // The candidate belongs to the thread's application; without one the item
  // cannot be attached to any tracker (honest skip, audit explains).
  const applicationId = extraction.applicationId;
  if (!applicationId) throw ValidationError("The thread has no application linkage — cannot attach the approved finding.");

  // Match an existing finding by normalized title — else create.
  let findingId: number | null = null;
  let code = "";
  let created = false;
  const candidates = await prisma.finding.findMany({
    where: { applicationId },
    select: { id: true, code: true, title: true },
  });
  const normalized = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200);
  const hit = candidates.find((c) => normalized(c.title) === normalized(title));
  if (hit) {
    findingId = hit.id;
    code = hit.code;
  }
  if (findingId === null) {
    const createdRow = await createFinding(
      {
        applicationId,
        title,
        severityValue: finalSeverity,
        description: typeof item.description === "string" && item.description.length > 0 ? item.description.slice(0, 3800) : undefined,
        firstSeenIterationNumber: iterationNumber,
      },
      actorUserId,
      {},
    );
    findingId = createdRow.id;
    code = createdRow.code;
    created = true;
  }

  // Resolve the target iteration (I1 or I2), provisioning the container when
  // the application has none yet — same behavior as the Excel finding import.
  const { ensureIterations } = await import("./finding-import-service");
  const { i1, i2 } = await ensureIterations(applicationId, actorUserId);
  const iterationId = iterationNumber === 2 && i2 !== null ? i2 : i1;
  const iterationLabel = iterationId === i2 ? "I2" : "I1";

  await setFindingIterationState(
    { findingId: findingId!, iterationId, severityValue: finalSeverity, statusValue },
    actorUserId,
    { source: "AI" },
  );

  return { findingId: findingId!, code, created, iterationLabel };
}
