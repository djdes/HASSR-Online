ALTER TABLE "PlatformRole" ADD COLUMN     "discountLimit" INTEGER;

CREATE TABLE "CrmDeal" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "ownerId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'registered',
    "stageManual" BOOLEAN NOT NULL DEFAULT false,
    "periodEnd" TIMESTAMP(3),
    "offerJson" JSONB,
    "amountRub" INTEGER,
    "contractSignedAt" TIMESTAMP(3),
    "messageSentAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3),
    "invoiceOrderId" INTEGER,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmDeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmTask" (
    "id" TEXT NOT NULL,
    "dealId" TEXT,
    "contactId" TEXT,
    "organizationId" TEXT,
    "assigneeId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "result" TEXT,
    "resultNote" TEXT,
    "scenario" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "payloadJson" JSONB,
    "createdById" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmDeal_dedupeKey_key" ON "CrmDeal"("dedupeKey");

CREATE INDEX "CrmDeal_stage_periodEnd_idx" ON "CrmDeal"("stage", "periodEnd");

CREATE INDEX "CrmDeal_unitKey_idx" ON "CrmDeal"("unitKey");

CREATE INDEX "CrmDeal_organizationId_idx" ON "CrmDeal"("organizationId");

CREATE INDEX "CrmDeal_ownerId_idx" ON "CrmDeal"("ownerId");

CREATE INDEX "CrmDeal_contactId_idx" ON "CrmDeal"("contactId");

CREATE UNIQUE INDEX "CrmTask_dedupeKey_key" ON "CrmTask"("dedupeKey");

CREATE INDEX "CrmTask_assigneeId_status_dueAt_idx" ON "CrmTask"("assigneeId", "status", "dueAt");

CREATE INDEX "CrmTask_status_dueAt_idx" ON "CrmTask"("status", "dueAt");

CREATE INDEX "CrmTask_dealId_idx" ON "CrmTask"("dealId");

CREATE INDEX "CrmTask_contactId_idx" ON "CrmTask"("contactId");

CREATE INDEX "CrmTask_organizationId_idx" ON "CrmTask"("organizationId");

ALTER TABLE "CrmTask" ADD CONSTRAINT "CrmTask_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;