/**
 * Zod validation boundary (brief sections 3/8/50). Schemas are shared by the
 * API layer AND server actions — a single source of truth for input rules.
 */
import { z } from "zod";

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const LoginSchema = z.object({
  email: trimmed(3, 254).email("Enter a valid email address."),
  password: trimmed(1, 200),
});

export const ApplicationTypeValue = z.enum(["web", "mobile", "api", "other"]);
export const ScopeValue = z.enum(["internal", "external"]);
export const EnvironmentValue = z.enum(["prod", "uat", "staging", "dev", "unknown"]);
export const ApplicationStatusValue = z.enum(["active", "inactive"]);

const optionalText = z.string().trim().max(500).transform((v) => (v.length ? v : null)).nullable().optional();

export const CreateApplicationSchema = z.object({
  name: trimmed(2, 200),
  displayName: trimmed(1, 200).optional(),
  applicationTypeValue: ApplicationTypeValue,
  scopeValue: ScopeValue,
  environmentValue: EnvironmentValue,
  statusValue: ApplicationStatusValue.optional(),
  webUrl: z.union([z.literal(""), z.string().trim().url("Enter a valid URL.")]).nullable().optional(),
  apiFqdn: z.union([z.literal(""), trimmed(0, 253).regex(/^[a-zA-Z0-9.\-]+$/, "Enter a valid FQDN.")]).nullable().optional(),
  rawTarget: optionalText,
  primaryPocId: z.number().int().positive().nullable().optional(),
});
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>;

export const UpdateApplicationSchema = z.object({
  displayName: trimmed(1, 200).optional(),
  applicationTypeValue: ApplicationTypeValue.optional(),
  scopeValue: ScopeValue.optional(),
  environmentValue: EnvironmentValue.optional(),
  statusValue: ApplicationStatusValue.optional(),
  webUrl: z.union([z.literal(""), z.string().trim().url()]).nullable().optional(),
  apiFqdn: z.union([z.literal(""), trimmed(0, 253).regex(/^[a-zA-Z0-9.\-]+$/)]).nullable().optional(),
  rawTarget: optionalText,
  primaryPocId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateApplicationInput = z.infer<typeof UpdateApplicationSchema>;

export const AddAliasSchema = z.object({
  applicationId: z.number().int().positive(),
  alias: trimmed(1, 300),
  aliasTypeValue: z.enum(["name", "shortname", "fqdn", "url", "package", "email_subject", "other"]).optional(),
  isPrimary: z.boolean().optional(),
  notes: optionalText,
});
export type AddAliasInput = z.infer<typeof AddAliasSchema>;

export const RemoveAliasSchema = z.object({ aliasId: z.number().int().positive() });

export const EngagementTypeValue = z.enum(["initial_scan", "retest", "follow_up", "other"]);
export const IterationStatusValue = z.enum(["planned", "in_progress", "pending", "completed", "cancelled"]);
export const EngagementStatusValue = z.enum(["initiated", "in_progress", "pending", "on_hold", "completed", "cancelled"]);
export const AssessmentSourceValue = z.enum(["manual_burp", "ai_assisted", "manual_mobsf", "mobsf_manual", "manual_revalidation", "vapt_blackbox", "vapt", "other"]);

export const CreateEngagementSchema = z.object({
  applicationId: z.number().int().positive(),
  name: trimmed(2, 200),
  scopeValue: ScopeValue,
  assessmentSourceValue: AssessmentSourceValue,
  target: optionalText,
  mailSubject: optionalText,
  statusValue: EngagementStatusValue.optional(),
  requestedDate: z.coerce.date().nullable().optional(),
  reportDate: z.coerce.date().nullable().optional(),
  notes: optionalText,
});

export const CreateIterationSchema = z.object({
  engagementId: z.number().int().positive(),
  iterationTypeValue: EngagementTypeValue,
  name: trimmed(0, 200).optional(),
  startDate: z.coerce.date().nullable().optional(),
  reportDate: z.coerce.date().nullable().optional(),
  statusValue: IterationStatusValue.optional(),
});

export const SeverityValue = z.enum(["critical", "high", "medium", "low", "info"]);
export const FindingStatusValue = z.enum(["open", "fixed", "not_fixed", "accepted_risk", "removed", "duplicate"]);
export const FindingIterationStatusValue = z.enum(["open", "new", "fixed", "not_fixed", "not_retested", "removed", "out_of_scope", "not_applicable", "unknown"]);

export const CreateFindingSchema = z.object({
  applicationId: z.number().int().positive(),
  code: trimmed(0, 32).optional(),
  title: trimmed(3, 300),
  description: optionalText,
  severityValue: SeverityValue,
  currentStatusValue: FindingStatusValue.optional(),
});

export const SetFindingIterationStateSchema = z.object({
  findingId: z.number().int().positive(),
  iterationId: z.number().int().positive(),
  severityValue: SeverityValue,
  statusValue: FindingIterationStatusValue,
  firstSeenAt: z.coerce.date().nullable().optional(),
  retestNote: optionalText,
  comments: optionalText,
});

export const TestCaseStatusValue = z.enum(["included", "tested", "not_tested", "passed", "failed", "removed", "retested", "not_retested", "out_of_scope", "not_applicable", "unknown"]);

export const CreateTestCaseSchema = z.object({
  applicationId: z.number().int().positive(),
  code: trimmed(0, 32).optional(),
  title: trimmed(3, 300),
  description: optionalText,
  category: optionalText,
  statusValue: TestCaseStatusValue,
});

export const SetTestCaseIterationStateSchema = z.object({
  testCaseId: z.number().int().positive(),
  iterationId: z.number().int().positive(),
  statusValue: TestCaseStatusValue,
  notes: optionalText,
});

export const EmailThreadSchema = z.object({
  applicationId: z.number().int().positive().nullable().optional(),
  subject: trimmed(3, 500),
});

export const EmailParticipantRoleValue = z.enum(["pentester", "developer", "application_owner", "security_team", "management", "other", "unknown"]);

export const CreateEmailMessageSchema = z.object({
  threadId: z.number().int().positive(),
  messageId: trimmed(5, 500),
  fromParticipantId: z.number().int().positive(),
  subject: optionalText,
  inReplyTo: optionalText,
  references: optionalText,
  sentAt: z.coerce.date().nullable().optional(),
  bodyText: z.string().max(100_000).nullable().optional(),
  bodyHtml: z.string().max(200_000).nullable().optional(),
  sourceFile: optionalText,
  recipients: z
    .array(
      z.object({
        kind: z.enum(["TO", "CC", "BCC"]),
        email: trimmed(3, 254).email(),
        name: trimmed(0, 200).optional(),
        participantId: z.number().int().positive().optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const CreateAttachmentSchema = z.object({
  messageId: z.number().int().positive(),
  filename: trimmed(1, 300),
  contentType: optionalText,
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  storageReference: optionalText,
  sha256: trimmed(0, 64).regex(/^[a-f0-9]*$/, "sha256 must be hex").nullable().optional(),
});

export const CreateExtractionSchema = z.object({
  sourceMessageId: z.number().int().positive().nullable().optional(),
  sourceAttachmentId: z.number().int().positive().nullable().optional(),
  applicationId: z.number().int().positive().nullable().optional(),
  extractionType: trimmed(3, 100),
  rawOutput: z.string().max(100_000).nullable().optional(),
  structuredOutput: z.unknown().nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  statusValue: z.enum(["pending", "processed", "needs_review", "approved", "rejected", "failed"]).optional(),
});

export const AddEvidenceSchema = z.object({
  extractionId: z.number().int().positive(),
  sourceType: z.enum(["EMAIL_MESSAGE", "EMAIL_ATTACHMENT", "APPLICATION", "ITERATION", "FINDING", "TEST_CASE"]),
  sourceId: z.number().int().positive(),
  field: trimmed(1, 200),
  extractedValue: trimmed(1, 500),
  excerpt: z.string().max(4000).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
});

export const ApprovalDecisionSchema = z.object({
  extractionId: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  note: optionalText,
});

export const UpsertParticipantSchema = z.object({
  emailAddress: trimmed(3, 254).email(),
  name: trimmed(1, 200),
  roleValue: EmailParticipantRoleValue,
  roleSource: z.enum(["UNKNOWN", "RULE", "AI", "HUMAN"]).default("RULE"),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Phase 2.1 — AI provider configuration (§12)
// ---------------------------------------------------------------------------
export const AiProviderValue = z.enum(["opencode"]);

/**
 * POST /api/settings/ai
 * `action:"SAVE"`      — save provider/enabled; apiKey blank ⇒ preserve stored key;
 *                        apiKey non-empty ⇒ replace (min length enforced).
 * `action:"CLEAR_KEY"` — explicit, confirmation-gated in the UI; wipes the envelope.
 */
export const SaveAiConfigSchema = z
  .object({
    action: z.enum(["SAVE", "CLEAR_KEY"]).default("SAVE"),
    provider: AiProviderValue,
    enabled: z.boolean().optional(),
    // The key itself: trim; optional. Format flexibility owned by the provider.
    apiKey: z.string().trim().min(0).max(400).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "SAVE" && typeof data.apiKey === "string" && data.apiKey.length > 0 && data.apiKey.length < 8) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["apiKey"], message: "API key looks too short (minimum 8 characters)." });
    }
  });

export const TestAiConfigSchema = z.object({
  provider: AiProviderValue,
});
