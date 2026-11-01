import { forbidden, notFound } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasJournalAccess } from "@/lib/journal-acl";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { checklistInspectionInArea, checklistInspectionReadWhere } from "@/lib/custom-checklists.server";
import { canReviewInspection } from "@/lib/checklist-results";
import { formatChecklistTimestamp } from "@/lib/custom-checklist-display";
import { ChecklistInspectionClient } from "@/components/checklists/checklist-inspection-client";
import { ChecklistReviewBar } from "@/components/checklists/checklist-review-bar";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default async function ChecklistInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!(await hasJournalAccess(session.user, CHECKLIST_CODE))) forbidden();
  const { id } = await params;
  // Свои проверки, все — с `journals.manage`, и те, где человек проверяющий по назначению.
  const inspection = await db.checklistInspection.findFirst({
    where: { id, ...checklistInspectionReadWhere({ organizationId: getActiveOrgId(session), canManage: hasCapability(session.user, "journals.manage"), userId: session.user.id }) },
    select: { id: true, status: true, reviewedAt: true, reviewedByName: true, createdById: true, assignmentId: true, assignment: { select: { verifierUserId: true } } },
  });
  // Точка (2026-11-01, «точка видит только своё»): проверка другой точки — «не найдена».
  if (!inspection || !(await checklistInspectionInArea(session, getActiveOrgId(session), inspection))) notFound();
  const canReview = canReviewInspection({
    status: inspection.status,
    reviewedAt: inspection.reviewedAt,
    verifierUserId: inspection.assignment?.verifierUserId ?? null,
    userId: session.user.id,
    isAdmin: hasCapability(session.user, "admin.full"),
  });
  return (
    <div className="space-y-4">
      {canReview || inspection.reviewedAt ? (
        <DomainMessagesBoundary namespaces={["checklistPages"]}>
          <ChecklistReviewBar inspectionId={id} canReview={canReview} reviewedAtLabel={inspection.reviewedAt ? formatChecklistTimestamp(inspection.reviewedAt) : null} reviewedByName={inspection.reviewedByName} />
        </DomainMessagesBoundary>
      ) : null}
      <ChecklistInspectionClient id={id} />
    </div>
  );
}
