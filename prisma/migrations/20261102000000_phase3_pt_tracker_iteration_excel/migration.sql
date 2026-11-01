-- AlterTable
ALTER TABLE "export_jobs" ADD COLUMN     "filename" TEXT,
ADD COLUMN     "schemaVersionId" INTEGER;

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "firstSeenIterationNumber" INTEGER,
ADD COLUMN     "matchKey" TEXT,
ADD COLUMN     "testCaseId" INTEGER;

-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "preview" JSONB,
ADD COLUMN     "schemaVersionId" INTEGER,
ADD COLUMN     "warningCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "iterations" ADD COLUMN     "importSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "findings_testCaseId_idx" ON "findings"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "findings_applicationId_matchKey_key" ON "findings"("applicationId", "matchKey");

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "test_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_schemaVersionId_fkey" FOREIGN KEY ("schemaVersionId") REFERENCES "schema_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_schemaVersionId_fkey" FOREIGN KEY ("schemaVersionId") REFERENCES "schema_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

