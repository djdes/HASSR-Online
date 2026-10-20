ALTER TABLE "ChecklistInspection" ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "reviewedByName" TEXT;

CREATE TABLE "ChecklistAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "onceDate" TEXT,
    "weekday" INTEGER,
    "monthDay" INTEGER,
    "dueTime" TEXT NOT NULL,
    "verifierUserId" TEXT,
    "remindTelegram" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "lastReminderPeriodKey" TEXT,
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChecklistAssignment_organizationId_active_idx" ON "ChecklistAssignment"("organizationId", "active");

CREATE INDEX "ChecklistAssignment_templateId_idx" ON "ChecklistAssignment"("templateId");

CREATE INDEX "ChecklistInspection_assignmentId_idx" ON "ChecklistInspection"("assignmentId");

ALTER TABLE "ChecklistAssignment" ADD CONSTRAINT "ChecklistAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistAssignment" ADD CONSTRAINT "ChecklistAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChecklistInspection" ADD CONSTRAINT "ChecklistInspection_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ChecklistAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;