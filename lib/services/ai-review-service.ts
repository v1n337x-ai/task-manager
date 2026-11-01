/**
 * AI review service (Phase 5 §39-§44, §67-§76).
 * Item-level decisions from AIApprovalDecision rows keyed by extractionId+itemKey.
 * The AI result is NEVER mutated; corrections live beside it.
 */
import type { AiApprovalDecision } from "@prisma/client";

export type DecisionKind = "approve" | "reject" | "correct" | "partially_approved";

export interface ItemDecision {
  itemKey: string;
  decision: DecisionKind;
  correctedValue: unknown;
  note: string | null;
  decidedByUserId: number;
  decidedAt: string;
}

export function findItemDecisions(rows: AiApprovalDecision[]): ItemDecision[] {
  return rows
    .filter((r) => r.itemKey !== null && r.itemKey !== "__run__")
    .map((r) => ({
      itemKey: r.itemKey!,
      decision: r.decision as DecisionKind,
      correctedValue: r.correctedValue,
      note: r.note,
      decidedByUserId: r.decidedByUserId,
      decidedAt: r.decidedAt.toISOString(),
    }));
}

/** Whole-run decision summary for the review banner. */
export function runDecision(rows: AiApprovalDecision[]): { decision: string; decidedAt: string; decidedByUserId: number } | null {
  const run = rows.find((r) => r.itemKey === null || r.itemKey === "__run__");
  return run ? { decision: run.decision, decidedAt: run.decidedAt.toISOString(), decidedByUserId: run.decidedByUserId } : null;
}

/** Item key builders — deterministic and stable across runs of the same output shape. */
export const itemKeys = {
  participant: (email: string) => `participant:${email}`,
  role: (email: string) => `participantRole:${email}`,
  findingStatus: (index: number) => `finding:${index}.status`,
  findingSeverity: (index: number) => `finding:${index}.severity`,
  findingTitle: (index: number) => `finding:${index}.title`,
  findingMatch: (index: number) => `finding:${index}.candidateMatch`,
  newFinding: (index: number) => `finding:${index}.isNewFindingCandidate`,
  testCaseState: (index: number, tcRef: string) => `testCase:${index}.${tcRef}.stateSignal`,
  iteration: (index: number) => `iterationSignal:${index}`,
  application: () => "application",
  summary: () => "summary",
};
