import { notFound } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasJournalAccess } from "@/lib/journal-acl";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { ChecklistInspectionClient } from "@/components/checklists/checklist-inspection-client";

export default async function ChecklistInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (!(await hasJournalAccess(session.user, CHECKLIST_CODE))) notFound();
  const { id } = await params;
  const inspection = await db.checklistInspection.findFirst({ where: { id, organizationId: getActiveOrgId(session), ...(hasCapability(session.user, "journals.manage") ? {} : { createdById: session.user.id }) }, select: { id: true } });
  if (!inspection) notFound();
  return <ChecklistInspectionClient id={id} />;
}
