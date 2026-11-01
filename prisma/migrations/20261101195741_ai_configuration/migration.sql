-- CreateEnum
CREATE TYPE "AiTestStatus" AS ENUM ('NOT_TESTED', 'PASSED', 'FAILED', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "ai_configurations" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "apiKeyLast4" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" "AiTestStatus" NOT NULL DEFAULT 'NOT_TESTED',
    "lastTestMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_configurations_provider_key" ON "ai_configurations"("provider");

-- CreateIndex
CREATE INDEX "ai_configurations_enabled_idx" ON "ai_configurations"("enabled");
