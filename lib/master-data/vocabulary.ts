/**
 * Controlled master-data vocabulary (brief sections 14/19/21/25/29/32/36).
 * Values derive from Phase 1's real workbook vocabulary (DL-03 §5) extended with
 * the Phase 2 status machines. Admins can add values via Master Data in later
 * phases; these are the bootstrap defaults used by the seed.
 */
export interface MasterSeedEntry {
  domain: string;
  value: string;
  label: string;
  sortOrder: number;
}

export const MASTER_VALUES: MasterSeedEntry[] = [
  // application types (observed raw labels preserved as labels)
  { domain: "application_type", value: "web", label: "Web", sortOrder: 1 },
  { domain: "application_type", value: "mobile", label: "Mobile", sortOrder: 2 },
  { domain: "application_type", value: "api", label: "API", sortOrder: 3 },
  { domain: "application_type", value: "other", label: "Other", sortOrder: 4 },

  // environments
  { domain: "environment", value: "prod", label: "Production", sortOrder: 1 },
  { domain: "environment", value: "uat", label: "UAT", sortOrder: 2 },
  { domain: "environment", value: "staging", label: "Staging", sortOrder: 3 },
  { domain: "environment", value: "dev", label: "Development", sortOrder: 4 },
  { domain: "environment", value: "unknown", label: "Unknown", sortOrder: 5 },

  // scope (Internal / External)
  { domain: "scope", value: "internal", label: "Internal", sortOrder: 1 },
  { domain: "scope", value: "external", label: "External", sortOrder: 2 },

  // application lifecycle
  { domain: "application_status", value: "active", label: "Active", sortOrder: 1 },
  { domain: "application_status", value: "inactive", label: "Inactive", sortOrder: 2 },

  // engagement lifecycle (workbook vocabulary preserved: DL-03 §5)
  { domain: "engagement_status", value: "initiated", label: "Initiated / Walkthrough Pending", sortOrder: 1 },
  { domain: "engagement_status", value: "in_progress", label: "In Progress", sortOrder: 2 },
  { domain: "engagement_status", value: "pending", label: "Pending", sortOrder: 3 },
  { domain: "engagement_status", value: "on_hold", label: "On Hold", sortOrder: 4 },
  { domain: "engagement_status", value: "completed", label: "Completed", sortOrder: 5 },
  { domain: "engagement_status", value: "cancelled", label: "Cancelled", sortOrder: 6 },

  // iteration types (brief section 19 — exactly these four)
  { domain: "iteration_type", value: "initial_scan", label: "Initial Scan", sortOrder: 1 },
  { domain: "iteration_type", value: "retest", label: "Retest", sortOrder: 2 },
  { domain: "iteration_type", value: "follow_up", label: "Follow-up", sortOrder: 3 },
  { domain: "iteration_type", value: "other", label: "Other", sortOrder: 4 },

  // iteration lifecycle
  { domain: "iteration_status", value: "planned", label: "Planned", sortOrder: 1 },
  { domain: "iteration_status", value: "in_progress", label: "In Progress", sortOrder: 2 },
  { domain: "iteration_status", value: "pending", label: "Pending", sortOrder: 3 },
  { domain: "iteration_status", value: "completed", label: "Completed", sortOrder: 4 },
  { domain: "iteration_status", value: "cancelled", label: "Cancelled", sortOrder: 5 },

  // test-case states (brief section 21; Phase 3 §46 adds Tested / Retested)
  { domain: "test_case_status", value: "included", label: "Included", sortOrder: 1 },
  { domain: "test_case_status", value: "tested", label: "Tested", sortOrder: 2 },
  { domain: "test_case_status", value: "passed", label: "Passed", sortOrder: 3 },
  { domain: "test_case_status", value: "failed", label: "Failed", sortOrder: 4 },
  { domain: "test_case_status", value: "removed", label: "Removed", sortOrder: 5 },
  { domain: "test_case_status", value: "retested", label: "Retested", sortOrder: 6 },
  { domain: "test_case_status", value: "not_retested", label: "Not Retested", sortOrder: 7 },
  { domain: "test_case_status", value: "not_tested", label: "Not Tested", sortOrder: 8 },
  { domain: "test_case_status", value: "out_of_scope", label: "Out of Scope", sortOrder: 9 },
  { domain: "test_case_status", value: "not_applicable", label: "Not Applicable", sortOrder: 10 },
  { domain: "test_case_status", value: "unknown", label: "Not Specified", sortOrder: 11 },

  // finding surface status
  { domain: "finding_status", value: "open", label: "Open", sortOrder: 1 },
  { domain: "finding_status", value: "fixed", label: "Fixed", sortOrder: 2 },
  { domain: "finding_status", value: "not_fixed", label: "Not Fixed", sortOrder: 3 },
  { domain: "finding_status", value: "reopened", label: "Reopened", sortOrder: 4 },
  { domain: "finding_status", value: "retested", label: "Retested", sortOrder: 5 },
  { domain: "finding_status", value: "accepted_risk", label: "Accepted Risk (CAR)", sortOrder: 6 },
  { domain: "finding_status", value: "removed", label: "Removed", sortOrder: 7 },
  { domain: "finding_status", value: "duplicate", label: "Duplicate", sortOrder: 8 },

  // finding per-iteration status (brief section 24: Fixed / Not Fixed required;
  // Phase 3 §17 adds New; §16 removal states)
  { domain: "finding_iteration_status", value: "open", label: "Open", sortOrder: 1 },
  { domain: "finding_iteration_status", value: "new", label: "New", sortOrder: 2 },
  { domain: "finding_iteration_status", value: "fixed", label: "Fixed", sortOrder: 3 },
  { domain: "finding_iteration_status", value: "not_fixed", label: "Not Fixed", sortOrder: 4 },
  { domain: "finding_iteration_status", value: "not_retested", label: "Not Retested", sortOrder: 5 },
  { domain: "finding_iteration_status", value: "removed", label: "Removed", sortOrder: 6 },
  { domain: "finding_iteration_status", value: "out_of_scope", label: "Out of Scope", sortOrder: 7 },
  { domain: "finding_iteration_status", value: "not_applicable", label: "Not Applicable", sortOrder: 8 },
  { domain: "finding_iteration_status", value: "unknown", label: "Unknown / Not Specified", sortOrder: 9 },

  // severities (PPT palette; CAR is a status, not a severity — DL-06 decision 3)
  { domain: "severity", value: "critical", label: "Critical", sortOrder: 1 },
  { domain: "severity", value: "high", label: "High", sortOrder: 2 },
  { domain: "severity", value: "medium", label: "Medium", sortOrder: 3 },
  { domain: "severity", value: "low", label: "Low", sortOrder: 4 },
  { domain: "severity", value: "info", label: "Info", sortOrder: 5 },

  // sources / tools (observed raw values from the tracker, G column)
  { domain: "assessment_source", value: "manual_burp", label: "Manual Testing / Burp", sortOrder: 1 },
  { domain: "assessment_source", value: "ai_assisted", label: "AI Assisted", sortOrder: 2 },
  { domain: "assessment_source", value: "manual_mobsf", label: "VAPT (Manual + MobSF Static Analysis)", sortOrder: 3 },
  { domain: "assessment_source", value: "mobsf_manual", label: "VAPT (MobSF Static Analysis + Manual Validation)", sortOrder: 4 },
  { domain: "assessment_source", value: "manual_revalidation", label: "VAPT (Manual + Revalidation)", sortOrder: 5 },
  { domain: "assessment_source", value: "vapt_blackbox", label: "VAPT / Black Box Testing", sortOrder: 6 },
  { domain: "assessment_source", value: "vapt", label: "VAPT", sortOrder: 7 },
  { domain: "assessment_source", value: "other", label: "Other", sortOrder: 8 },

  // test approaches (brief section 14 "Test Approaches")
  { domain: "test_approach", value: "black_box", label: "Black Box", sortOrder: 1 },
  { domain: "test_approach", value: "static_analysis", label: "Static Analysis", sortOrder: 2 },
  { domain: "test_approach", value: "api_testing", label: "API Testing", sortOrder: 3 },
  { domain: "test_approach", value: "manual_validation", label: "Manual Validation", sortOrder: 4 },

  // participant roles (brief section 29)
  { domain: "participant_role", value: "pentester", label: "Pentester", sortOrder: 1 },
  { domain: "participant_role", value: "developer", label: "Developer", sortOrder: 2 },
  { domain: "participant_role", value: "application_owner", label: "Application Owner", sortOrder: 3 },
  { domain: "participant_role", value: "security_team", label: "Security Team", sortOrder: 4 },
  { domain: "participant_role", value: "management", label: "Management", sortOrder: 5 },
  { domain: "participant_role", value: "other", label: "Other", sortOrder: 6 },
  { domain: "participant_role", value: "unknown", label: "Unknown", sortOrder: 7 },

  // alias types (brief sections 16-17)
  { domain: "alias_type", value: "name", label: "Application Name", sortOrder: 1 },
  { domain: "alias_type", value: "shortname", label: "Short Name", sortOrder: 2 },
  { domain: "alias_type", value: "fqdn", label: "FQDN", sortOrder: 3 },
  { domain: "alias_type", value: "url", label: "URL", sortOrder: 4 },
  { domain: "alias_type", value: "package", label: "Package / Bundle ID", sortOrder: 5 },
  { domain: "alias_type", value: "email_subject", label: "Email Subject Fragment", sortOrder: 6 },
  { domain: "alias_type", value: "other", label: "Other", sortOrder: 7 },

  // attachment processing
  { domain: "attachment_status", value: "pending", label: "Pending", sortOrder: 1 },
  { domain: "attachment_status", value: "processing", label: "Processing", sortOrder: 2 },
  { domain: "attachment_status", value: "processed", label: "Processed", sortOrder: 3 },
  { domain: "attachment_status", value: "failed", label: "Failed", sortOrder: 4 },
  { domain: "attachment_status", value: "skipped", label: "Skipped", sortOrder: 5 },

  // AI extraction states (brief section 32)
  { domain: "extraction_status", value: "pending", label: "Pending", sortOrder: 1 },
  { domain: "extraction_status", value: "processed", label: "Processed", sortOrder: 2 },
  { domain: "extraction_status", value: "needs_review", label: "Needs Review", sortOrder: 3 },
  { domain: "extraction_status", value: "approved", label: "Approved", sortOrder: 4 },
  { domain: "extraction_status", value: "rejected", label: "Rejected", sortOrder: 5 },
  { domain: "extraction_status", value: "failed", label: "Failed", sortOrder: 6 },

  // job/import/export states (brief section 36; Phase 3 §29 pipeline states)
  { domain: "job_status", value: "queued", label: "Queued", sortOrder: 1 },
  { domain: "job_status", value: "validating", label: "Validating", sortOrder: 2 },
  { domain: "job_status", value: "ready", label: "Ready", sortOrder: 3 },
  { domain: "job_status", value: "processing", label: "Processing", sortOrder: 4 },
  { domain: "job_status", value: "completed", label: "Completed", sortOrder: 5 },
  { domain: "job_status", value: "completed_with_warnings", label: "Completed with Warnings", sortOrder: 6 },
  { domain: "job_status", value: "failed", label: "Failed", sortOrder: 7 },
  { domain: "job_status", value: "cancelled", label: "Cancelled", sortOrder: 8 },
];

export const MASTER_DOMAINS = [
  "application_type",
  "environment",
  "scope",
  "application_status",
  "engagement_status",
  "iteration_type",
  "iteration_status",
  "test_case_status",
  "finding_status",
  "finding_iteration_status",
  "severity",
  "assessment_source",
  "test_approach",
  "participant_role",
  "alias_type",
  "attachment_status",
  "extraction_status",
  "job_status",
] as const;

export type MasterDomain = (typeof MASTER_DOMAINS)[number];
