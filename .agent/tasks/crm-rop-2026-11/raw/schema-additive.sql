ALTER TABLE "User" ADD COLUMN     "platformSalesHead" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phoneKey" TEXT,
    "telegramChatId" TEXT,
    "userId" TEXT,
    "organizationId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "ownerId" TEXT,
    "source" TEXT NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awaitingSince" TIMESTAMP(3),
    "nextActionAt" TIMESTAMP(3),
    "nextActionNote" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmInteraction" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "href" TEXT,
    "fromAddress" TEXT,
    "fromName" TEXT,
    "filteredReason" TEXT,
    "authorUserId" TEXT,
    "authorName" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmInteraction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmMailbox" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 993,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "inboxFolder" TEXT NOT NULL DEFAULT 'INBOX',
    "sentFolder" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inboxUidValidity" TEXT,
    "inboxLastUid" INTEGER NOT NULL DEFAULT 0,
    "sentUidValidity" TEXT,
    "sentLastUid" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmMailbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmSenderRule" (
    "id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSenderRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmReminderLog" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "contactId" TEXT,
    "kind" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmContact_email_idx" ON "CrmContact"("email");

CREATE INDEX "CrmContact_phoneKey_idx" ON "CrmContact"("phoneKey");

CREATE INDEX "CrmContact_telegramChatId_idx" ON "CrmContact"("telegramChatId");

CREATE INDEX "CrmContact_userId_idx" ON "CrmContact"("userId");

CREATE INDEX "CrmContact_organizationId_idx" ON "CrmContact"("organizationId");

CREATE INDEX "CrmContact_awaitingSince_idx" ON "CrmContact"("awaitingSince");

CREATE INDEX "CrmContact_nextActionAt_idx" ON "CrmContact"("nextActionAt");

CREATE INDEX "CrmContact_stage_lastActivityAt_idx" ON "CrmContact"("stage", "lastActivityAt");

CREATE INDEX "CrmContact_ownerId_idx" ON "CrmContact"("ownerId");

CREATE INDEX "CrmContact_lastActivityAt_idx" ON "CrmContact"("lastActivityAt");

CREATE UNIQUE INDEX "CrmInteraction_externalKey_key" ON "CrmInteraction"("externalKey");

CREATE INDEX "CrmInteraction_contactId_occurredAt_idx" ON "CrmInteraction"("contactId", "occurredAt");

CREATE INDEX "CrmInteraction_filteredReason_occurredAt_idx" ON "CrmInteraction"("filteredReason", "occurredAt");

CREATE INDEX "CrmInteraction_occurredAt_idx" ON "CrmInteraction"("occurredAt");

CREATE UNIQUE INDEX "CrmSenderRule_pattern_key" ON "CrmSenderRule"("pattern");

CREATE UNIQUE INDEX "CrmReminderLog_dedupeKey_key" ON "CrmReminderLog"("dedupeKey");

CREATE INDEX "CrmReminderLog_contactId_idx" ON "CrmReminderLog"("contactId");

ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;