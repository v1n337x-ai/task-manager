-- CreateEnum
CREATE TYPE "StateDecisionSource" AS ENUM ('STRUCTURED_DATA', 'COMMUNICATION', 'AI_APPROVED', 'HUMAN_CORRECTION', 'SYSTEM_CALCULATION');

-- CreateTable
CREATE TABLE "authoritative_state_decisions" (
    "id" SERIAL NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "iterationId" INTEGER,
    "iterationNumber" INTEGER,
    "previousState" TEXT,
    "newState" TEXT NOT NULL,
    "verification" TEXT,
    "resolutionMethod" TEXT NOT NULL,
    "decisionSource" "StateDecisionSource" NOT NULL,
    "sourceMessageId" INTEGER,
    "sourceThreadId" INTEGER,
    "aiExtractionId" INTEGER,
    "evidenceRef" JSONB,
    "approvedByUserId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authoritative_state_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "authoritative_state_decisions_entityType_entityId_idx" ON "authoritative_state_decisions"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "authoritative_state_decisions_decisionSource_idx" ON "authoritative_state_decisions"("decisionSource");

-- CreateIndex
CREATE UNIQUE INDEX "authoritative_state_decisions_entityType_entityId_iteration_key" ON "authoritative_state_decisions"("entityType", "entityId", "iterationId", "newState", "sourceMessageId");

