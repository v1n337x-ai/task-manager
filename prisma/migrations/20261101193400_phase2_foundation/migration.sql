-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('HUMAN', 'EXCEL_IMPORT', 'EML', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('EMAIL_MESSAGE', 'EMAIL_ATTACHMENT', 'APPLICATION', 'ITERATION', 'FINDING', 'TEST_CASE');

-- CreateEnum
CREATE TYPE "ParticipantRoleSource" AS ENUM ('UNKNOWN', 'RULE', 'AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "RecipientKind" AS ENUM ('TO', 'CC', 'BCC');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isSuperuser" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_values" (
    "id" SERIAL NOT NULL,
    "domain" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "org" TEXT NOT NULL DEFAULT 'Akasa Air',
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "applicationType" INTEGER NOT NULL,
    "scope" INTEGER NOT NULL,
    "environment" INTEGER NOT NULL,
    "site" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "webUrl" TEXT,
    "apiFqdn" TEXT,
    "rawTarget" TEXT,
    "primaryPocId" INTEGER,
    "assessedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_assigned_members" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_assigned_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_aliases" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasType" INTEGER NOT NULL,
    "normalized" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagements" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "scope" INTEGER NOT NULL,
    "assessmentSource" INTEGER NOT NULL,
    "target" TEXT,
    "mailSubject" TEXT,
    "status" INTEGER NOT NULL,
    "requestedDate" TIMESTAMP(3),
    "reportDate" TIMESTAMP(3),
    "sortOrder" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iterations" (
    "id" SERIAL NOT NULL,
    "engagementId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "iterationType" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Initial Scan',
    "startDate" TIMESTAMP(3),
    "reportDate" TIMESTAMP(3),
    "status" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "iterations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_cases" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "currentStatus" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_case_iterations" (
    "id" SERIAL NOT NULL,
    "testCaseId" INTEGER NOT NULL,
    "iterationId" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "notes" TEXT,
    "evidenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_case_iterations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" INTEGER NOT NULL,
    "currentStatus" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_iteration_states" (
    "id" SERIAL NOT NULL,
    "findingId" INTEGER NOT NULL,
    "iterationId" INTEGER NOT NULL,
    "severity" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3),
    "retestNote" TEXT,
    "evidenceJson" JSONB,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finding_iteration_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_status_history" (
    "id" SERIAL NOT NULL,
    "findingId" INTEGER NOT NULL,
    "iterationId" INTEGER,
    "oldStatusCode" TEXT,
    "newStatusCode" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" INTEGER,
    "actorContactId" INTEGER,
    "source" "AuditSource" NOT NULL DEFAULT 'HUMAN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_threads" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER,
    "subject" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" SERIAL NOT NULL,
    "threadId" INTEGER NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "references" TEXT,
    "fromParticipantId" INTEGER NOT NULL,
    "subject" TEXT,
    "sentAt" TIMESTAMP(3),
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_participants" (
    "id" SERIAL NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" INTEGER NOT NULL,
    "roleSource" "ParticipantRoleSource" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" INTEGER,
    "humanOverrideRole" INTEGER,
    "overrideNote" TEXT,
    "overrideByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_recipients" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "kind" "RecipientKind" NOT NULL,
    "participantId" INTEGER,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "storageReference" TEXT,
    "sha256" TEXT,
    "processingStatus" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_extractions" (
    "id" SERIAL NOT NULL,
    "sourceMessageId" INTEGER,
    "sourceAttachmentId" INTEGER,
    "applicationId" INTEGER,
    "extractionType" TEXT NOT NULL,
    "rawOutput" TEXT,
    "structuredOutput" JSONB,
    "confidence" INTEGER,
    "status" INTEGER NOT NULL,
    "reviewedByUserId" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evidence" (
    "id" SERIAL NOT NULL,
    "extractionId" INTEGER NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "attachmentId" INTEGER,
    "field" TEXT NOT NULL,
    "extractedValue" TEXT NOT NULL,
    "excerpt" TEXT,
    "confidence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_approval_decisions" (
    "id" SERIAL NOT NULL,
    "extractionId" INTEGER NOT NULL,
    "findingId" INTEGER,
    "decision" TEXT NOT NULL,
    "decidedByUserId" INTEGER NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actorUserId" INTEGER,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "fieldName" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" "AuditSource" NOT NULL DEFAULT 'HUMAN',
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "sha256" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'xlsx_tracker',
    "status" INTEGER NOT NULL,
    "options" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" SERIAL NOT NULL,
    "target" TEXT NOT NULL DEFAULT 'xlsx',
    "targetVersion" TEXT,
    "status" INTEGER NOT NULL,
    "params" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schema_versions" (
    "id" SERIAL NOT NULL,
    "trackerName" TEXT NOT NULL DEFAULT 'PT Tracker',
    "version" TEXT NOT NULL DEFAULT '1.0',
    "columnsCount" INTEGER NOT NULL DEFAULT 39,
    "columnMap" JSONB,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- CreateIndex
CREATE INDEX "master_values_domain_isActive_idx" ON "master_values"("domain", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "master_values_domain_value_key" ON "master_values"("domain", "value");

-- CreateIndex
CREATE INDEX "contacts_org_fullName_idx" ON "contacts"("org", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_org_fullName_key" ON "contacts"("org", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "applications_name_key" ON "applications"("name");

-- CreateIndex
CREATE INDEX "applications_applicationType_idx" ON "applications"("applicationType");

-- CreateIndex
CREATE INDEX "applications_isActive_idx" ON "applications"("isActive");

-- CreateIndex
CREATE INDEX "applications_name_idx" ON "applications"("name");

-- CreateIndex
CREATE INDEX "application_assigned_members_contactId_idx" ON "application_assigned_members"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "application_assigned_members_applicationId_contactId_key" ON "application_assigned_members"("applicationId", "contactId");

-- CreateIndex
CREATE INDEX "application_aliases_normalized_idx" ON "application_aliases"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "application_aliases_applicationId_normalized_key" ON "application_aliases"("applicationId", "normalized");

-- CreateIndex
CREATE INDEX "engagements_applicationId_idx" ON "engagements"("applicationId");

-- CreateIndex
CREATE INDEX "engagements_status_idx" ON "engagements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "engagements_applicationId_name_key" ON "engagements"("applicationId", "name");

-- CreateIndex
CREATE INDEX "iterations_engagementId_idx" ON "iterations"("engagementId");

-- CreateIndex
CREATE INDEX "iterations_number_idx" ON "iterations"("number");

-- CreateIndex
CREATE UNIQUE INDEX "iterations_engagementId_number_key" ON "iterations"("engagementId", "number");

-- CreateIndex
CREATE INDEX "test_cases_applicationId_idx" ON "test_cases"("applicationId");

-- CreateIndex
CREATE INDEX "test_cases_code_idx" ON "test_cases"("code");

-- CreateIndex
CREATE UNIQUE INDEX "test_cases_applicationId_code_key" ON "test_cases"("applicationId", "code");

-- CreateIndex
CREATE INDEX "test_case_iterations_iterationId_idx" ON "test_case_iterations"("iterationId");

-- CreateIndex
CREATE INDEX "test_case_iterations_testCaseId_idx" ON "test_case_iterations"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "test_case_iterations_testCaseId_iterationId_key" ON "test_case_iterations"("testCaseId", "iterationId");

-- CreateIndex
CREATE INDEX "findings_applicationId_idx" ON "findings"("applicationId");

-- CreateIndex
CREATE INDEX "findings_code_idx" ON "findings"("code");

-- CreateIndex
CREATE INDEX "findings_severity_idx" ON "findings"("severity");

-- CreateIndex
CREATE UNIQUE INDEX "findings_applicationId_code_key" ON "findings"("applicationId", "code");

-- CreateIndex
CREATE INDEX "finding_iteration_states_findingId_idx" ON "finding_iteration_states"("findingId");

-- CreateIndex
CREATE INDEX "finding_iteration_states_iterationId_idx" ON "finding_iteration_states"("iterationId");

-- CreateIndex
CREATE UNIQUE INDEX "finding_iteration_states_findingId_iterationId_key" ON "finding_iteration_states"("findingId", "iterationId");

-- CreateIndex
CREATE INDEX "finding_status_history_findingId_createdAt_idx" ON "finding_status_history"("findingId", "createdAt");

-- CreateIndex
CREATE INDEX "finding_status_history_source_idx" ON "finding_status_history"("source");

-- CreateIndex
CREATE INDEX "email_threads_subjectHash_idx" ON "email_threads"("subjectHash");

-- CreateIndex
CREATE INDEX "email_threads_applicationId_idx" ON "email_threads"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "email_threads_subjectHash_applicationId_key" ON "email_threads"("subjectHash", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_messageId_key" ON "email_messages"("messageId");

-- CreateIndex
CREATE INDEX "email_messages_threadId_sentAt_idx" ON "email_messages"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "email_messages_fromParticipantId_idx" ON "email_messages"("fromParticipantId");

-- CreateIndex
CREATE UNIQUE INDEX "email_participants_emailAddress_key" ON "email_participants"("emailAddress");

-- CreateIndex
CREATE INDEX "email_participants_name_idx" ON "email_participants"("name");

-- CreateIndex
CREATE INDEX "email_participants_emailAddress_idx" ON "email_participants"("emailAddress");

-- CreateIndex
CREATE INDEX "email_recipients_messageId_idx" ON "email_recipients"("messageId");

-- CreateIndex
CREATE INDEX "email_recipients_participantId_idx" ON "email_recipients"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "email_recipients_messageId_kind_email_key" ON "email_recipients"("messageId", "kind", "email");

-- CreateIndex
CREATE INDEX "email_attachments_messageId_idx" ON "email_attachments"("messageId");

-- CreateIndex
CREATE INDEX "email_attachments_sha256_idx" ON "email_attachments"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "email_attachments_messageId_filename_sha256_key" ON "email_attachments"("messageId", "filename", "sha256");

-- CreateIndex
CREATE INDEX "ai_extractions_status_idx" ON "ai_extractions"("status");

-- CreateIndex
CREATE INDEX "ai_extractions_sourceMessageId_idx" ON "ai_extractions"("sourceMessageId");

-- CreateIndex
CREATE INDEX "ai_extractions_sourceAttachmentId_idx" ON "ai_extractions"("sourceAttachmentId");

-- CreateIndex
CREATE INDEX "ai_evidence_extractionId_idx" ON "ai_evidence"("extractionId");

-- CreateIndex
CREATE INDEX "ai_evidence_sourceType_sourceId_idx" ON "ai_evidence"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_approval_decisions_extractionId_key" ON "ai_approval_decisions"("extractionId");

-- CreateIndex
CREATE INDEX "ai_approval_decisions_extractionId_idx" ON "ai_approval_decisions"("extractionId");

-- CreateIndex
CREATE INDEX "ai_approval_decisions_decidedByUserId_idx" ON "ai_approval_decisions"("decidedByUserId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_source_idx" ON "audit_logs"("source");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "import_jobs_sha256_key" ON "import_jobs"("sha256");

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "import_jobs_createdAt_idx" ON "import_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "import_jobs_sha256_idx" ON "import_jobs"("sha256");

-- CreateIndex
CREATE INDEX "export_jobs_status_idx" ON "export_jobs"("status");

-- CreateIndex
CREATE INDEX "export_jobs_createdAt_idx" ON "export_jobs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "schema_versions_trackerName_version_key" ON "schema_versions"("trackerName", "version");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicationType_fkey" FOREIGN KEY ("applicationType") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_scope_fkey" FOREIGN KEY ("scope") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_environment_fkey" FOREIGN KEY ("environment") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_site_fkey" FOREIGN KEY ("site") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_primaryPocId_fkey" FOREIGN KEY ("primaryPocId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_assigned_members" ADD CONSTRAINT "application_assigned_members_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_assigned_members" ADD CONSTRAINT "application_assigned_members_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_aliases" ADD CONSTRAINT "application_aliases_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_aliases" ADD CONSTRAINT "application_aliases_aliasType_fkey" FOREIGN KEY ("aliasType") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_scope_fkey" FOREIGN KEY ("scope") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_assessmentSource_fkey" FOREIGN KEY ("assessmentSource") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_status_fkey" FOREIGN KEY ("status") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_iterationType_fkey" FOREIGN KEY ("iterationType") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iterations" ADD CONSTRAINT "iterations_status_fkey" FOREIGN KEY ("status") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_currentStatus_fkey" FOREIGN KEY ("currentStatus") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_iterations" ADD CONSTRAINT "test_case_iterations_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_iterations" ADD CONSTRAINT "test_case_iterations_iterationId_fkey" FOREIGN KEY ("iterationId") REFERENCES "iterations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_iterations" ADD CONSTRAINT "test_case_iterations_status_fkey" FOREIGN KEY ("status") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_severity_fkey" FOREIGN KEY ("severity") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_currentStatus_fkey" FOREIGN KEY ("currentStatus") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_iteration_states" ADD CONSTRAINT "finding_iteration_states_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_iteration_states" ADD CONSTRAINT "finding_iteration_states_iterationId_fkey" FOREIGN KEY ("iterationId") REFERENCES "iterations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_iteration_states" ADD CONSTRAINT "finding_iteration_states_severity_fkey" FOREIGN KEY ("severity") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_iteration_states" ADD CONSTRAINT "finding_iteration_states_status_fkey" FOREIGN KEY ("status") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_status_history" ADD CONSTRAINT "finding_status_history_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_status_history" ADD CONSTRAINT "finding_status_history_iterationId_fkey" FOREIGN KEY ("iterationId") REFERENCES "iterations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_status_history" ADD CONSTRAINT "finding_status_history_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_status_history" ADD CONSTRAINT "finding_status_history_actorContactId_fkey" FOREIGN KEY ("actorContactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_fromParticipantId_fkey" FOREIGN KEY ("fromParticipantId") REFERENCES "email_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_participants" ADD CONSTRAINT "email_participants_role_fkey" FOREIGN KEY ("role") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_participants" ADD CONSTRAINT "email_participants_humanOverrideRole_fkey" FOREIGN KEY ("humanOverrideRole") REFERENCES "master_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "email_participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_processingStatus_fkey" FOREIGN KEY ("processingStatus") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "email_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_sourceAttachmentId_fkey" FOREIGN KEY ("sourceAttachmentId") REFERENCES "email_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_status_fkey" FOREIGN KEY ("status") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evidence" ADD CONSTRAINT "ai_evidence_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "ai_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evidence" ADD CONSTRAINT "ai_evidence_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "email_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_decisions" ADD CONSTRAINT "ai_approval_decisions_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "ai_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_decisions" ADD CONSTRAINT "ai_approval_decisions_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approval_decisions" ADD CONSTRAINT "ai_approval_decisions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_status_fkey" FOREIGN KEY ("status") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_status_fkey" FOREIGN KEY ("status") REFERENCES "master_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
