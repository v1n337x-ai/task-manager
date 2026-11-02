-- CreateTable
CREATE TABLE "application_reports" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "iterationId" INTEGER,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "application_reports_applicationId_idx" ON "application_reports"("applicationId");

-- CreateIndex
CREATE INDEX "application_reports_iterationId_idx" ON "application_reports"("iterationId");

-- AddForeignKey
ALTER TABLE "application_reports" ADD CONSTRAINT "application_reports_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_reports" ADD CONSTRAINT "application_reports_iterationId_fkey" FOREIGN KEY ("iterationId") REFERENCES "iterations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_reports" ADD CONSTRAINT "application_reports_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
