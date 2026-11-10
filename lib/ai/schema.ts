/**
 * AI_EXTRACTION_V1 — versioned, Zod-validated structured output contract
 * (Phase 5 §11-§12, §47). AI output is never free-form in the DB path.
 * All candidate values carry explicitness + confidence + evidence references
 * so the reviewer can trace every claim (§32-§36). IDs must remain Candidate
 * until human approval (§19-§20).
 */
import { z } from "zod";
import { isGenericFindingTitle, titleSupportedByEvidence } from "./finding-quality";

const SeverityCandidate = z.enum(["critical", "high", "medium", "low", "info", "unknown"]);
const ConfidenceBand = z.enum(["HIGH", "MEDIUM", "LOW"]);
const RoleCandidate = z.enum(["pentester", "developer", "application_owner", "security_team", "management", "other", "unknown"]);
const StatusSignal = z.enum(["fixed", "not_fixed", "open", "reopened", "retested", "not_retested", "removed", "out_of_scope", "accepted_risk"]);
const IterationTypeSignal = z.enum(["initial_scan", "retest", "follow_up", "other"]);

const EvidenceRef = z.object({
  /** index of the message inside the ANALYZED CONTEXT (deterministic), not DB id */
  messageIndex: z.number().int(),
  /** exact relevant excerpt — never fabricated (§33) */
  excerpt: z.string().min(3).max(1500),
  confidence: ConfidenceBand,
  score: z.number().min(0).max(1).optional(),
});

const ParticipantOut = z.object({
  email: z.string(),
  name: z.string().nullable().optional(),
  proposedRole: RoleCandidate,
  roleBasis: z.enum(["EXPLICIT", "INFERRED"]),
  confidence: ConfidenceBand,
  score: z.number().min(0).max(1).optional(),
  evidence: z.array(EvidenceRef).min(1),
});

const FindingCandidate = z.object({
  identifierExplicit: z.string().nullable(), // e.g. "F-001" ONLY when explicitly present (§19)
  identifierMark: z.enum(["IDENTIFIER_EXPLICIT", "IDENTIFIER_NOT_EXPLICIT"]),
  title: z.string().min(3).max(300),
  titleMark: z.enum(["EXPLICIT", "AI_PROPOSED"]),
  severity: SeverityCandidate,
  severityMark: z.enum(["EXPLICIT", "INFERRED"]),
  description: z.string().max(4000).nullable().optional(),
  recommendation: z.string().max(2000).nullable().optional(),
  relatedTestCaseRefs: z.array(z.string()).max(10),
  iterationSignal: z.number().int().min(1).nullable().optional(),
  iterationSignalExplicit: z.boolean().optional(),
  statusSignal: StatusSignal.nullable().optional(),
  isNewFindingCandidate: z.boolean().optional(),
  evidence: z.array(EvidenceRef).min(1),
});

const TestCaseCandidate = z.object({
  identifierExplicit: z.string().nullable(), // "TC-004" ONLY when explicitly present
  identifierMark: z.enum(["IDENTIFIER_EXPLICIT", "IDENTIFIER_NOT_EXPLICIT"]),
  title: z.string().max(300),
  titleMark: z.enum(["EXPLICIT", "AI_PROPOSED"]),
  stateSignal: StatusSignal.nullable().optional(),
  stateSignalExplicit: z.boolean().optional(),
  evidence: z.array(EvidenceRef).min(1),
});

const IterationSignalOut = z.object({
  candidateIteration: z.number().int().min(1).nullable(),
  typeSignal: IterationTypeSignal.nullable().optional(),
  explicitOrInferred: z.enum(["EXPLICIT", "INFERRED"]),
  confidence: ConfidenceBand,
  evidence: z.array(EvidenceRef).min(1),
});

export const AI_EXTRACTION_V1 = z
  .object({
    schemaVersion: z.literal("AI_EXTRACTION_V1"),
    threadSummary: z.string().min(10).max(4000),
    participants: z.array(ParticipantOut).min(1),
    findings: z.array(FindingCandidate).max(50),
    testCases: z.array(TestCaseCandidate).max(50),
    iterationSignals: z.array(IterationSignalOut).max(20),
    evidence: z.array(EvidenceRef).min(1),
  })
  .superRefine((out, ctx) => {
    // §52 semantics: findings referencing messages must reference VALID context
    // indexes and every evidence excerpt must be non-trivial.
    const maxIndex = 500;
    for (const [i, f] of out.findings.entries()) {
      for (const [ei, ev] of f.evidence.entries()) {
        if (ev.messageIndex < 0 || ev.messageIndex > maxIndex) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["findings", i, "evidence", ei, "messageIndex"], message: "Evidence messageIndex outside the analyzed context." });
        }
      }
    }
    if (out.findings.some((f) => f.identifierExplicit && f.identifierMark === "IDENTIFIER_NOT_EXPLICIT")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["findings"], message: "identifierExplicit present but marked NOT_EXPLICIT — contradiction." });
    }
    for (const [i, f] of out.findings.entries()) {
      if (isGenericFindingTitle(f.title)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["findings", i, "title"],
          message: "Title is a generic status/remediation summary rather than a concrete vulnerability name.",
        });
      }

      if (
        f.titleMark !== "EXPLICIT" &&
        f.identifierMark !== "IDENTIFIER_EXPLICIT" &&
        !titleSupportedByEvidence(f.title, f.evidence)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["findings", i, "title"],
          message: "AI-proposed title is not sufficiently supported by the quoted evidence.",
        });
      }
    }
  });

export type AiExtractionV1 = z.infer<typeof AI_EXTRACTION_V1>;

export const PROMPT_VERSION = "VAPT_EMAIL_ANALYSIS_V3";
