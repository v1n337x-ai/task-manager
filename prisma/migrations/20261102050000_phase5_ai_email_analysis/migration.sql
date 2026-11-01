-- DropIndex
DROP INDEX "ai_approval_decisions_extractionId_key";

-- DropIndex
DROP INDEX "ai_extractions_sourceAttachmentId_idx";

-- AlterTable
ALTER TABLE "ai_approval_decisions" ADD COLUMN     "correctedValue" JSONB,
ADD COLUMN     "itemKey" TEXT;

-- AlterTable
ALTER TABLE "ai_extractions" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "inputContextHash" TEXT,
ADD COLUMN     "modelRaw" TEXT,
ADD COLUMN     "outputHash" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "providerSlug" TEXT,
ADD COLUMN     "schemaVersion" TEXT,
ADD COLUMN     "threadId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "ai_approval_decisions_extractionId_itemKey_key" ON "ai_approval_decisions"("extractionId", "itemKey");

-- CreateIndex
CREATE INDEX "ai_extractions_threadId_idx" ON "ai_extractions"("threadId");

-- CreateIndex
CREATE INDEX "ai_extractions_inputContextHash_idx" ON "ai_extractions"("inputContextHash");

-- AddForeignKey
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "email_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

