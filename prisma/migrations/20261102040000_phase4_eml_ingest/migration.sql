-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "headersRaw" JSONB;
ALTER TABLE "email_messages" ADD COLUMN     "replyTo" TEXT;

-- AlterTable
ALTER TABLE "email_threads" ADD COLUMN     "participantKey" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "email_messages_inReplyTo_idx" ON "email_messages"("inReplyTo");

-- CreateIndex
CREATE INDEX "email_threads_participantKey_idx" ON "email_threads"("participantKey");
