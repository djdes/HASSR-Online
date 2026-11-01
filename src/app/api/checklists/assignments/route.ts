import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { checklistAssignmentInputSchema } from "@/lib/checklist-assignments";
import { listAssignmentRows } from "@/lib/checklist-assignments.server";
import { loadAssignmentScope, requireAssignmentAccess, validateAssignmentRefs } from "@/lib/checklist-assignments.api";
import { assignmentRowsInArea } from "@/lib/checklist-point-scope";

export const dynamic = "force-dynamic";

/**
 * Назначения чек-листов (2026-10-19). GET — список со статусом текущего
 * периода (руководству); POST — новое назначение (`admin.full`).
 * Без TasksFlow: напоминания — крон `/api/cron/checklist-reminders`.
 * Точка (2026-11-01, «точка видит только своё»): список и новая цель — в
 * пределах точки из шапки и точек руководителя точки.
 */
export async function GET() {
  const auth = await requireAssignmentAccess("read");
  if (!auth.ok) return auth.response;
  const scope = await loadAssignmentScope(auth.session, auth.organizationId);
  const assignments = assignmentRowsInArea(scope.area, await listAssignmentRows(auth.organizationId, new Date(), scope.context));
  return NextResponse.json({ assignments }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireAssignmentAccess("write");
  if (!auth.ok) return auth.response;
  const parsed = checklistAssignmentInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Проверьте назначение" }, { status: 400 });
  const scope = await loadAssignmentScope(auth.session, auth.organizationId);
  const problem = await validateAssignmentRefs(auth.organizationId, parsed.data, new Date(), scope);
  if (problem) return problem;
  const assignment = await db.checklistAssignment.create({
    data: {
      organizationId: auth.organizationId,
      ...parsed.data,
      createdById: auth.session.user.id,
      createdByName: auth.session.user.name ?? "",
    },
    select: { id: true },
  });
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.organizationId,
    action: "checklist.assignment_create",
    entity: "ChecklistAssignment",
    entityId: assignment.id,
    details: parsed.data,
  });
  return NextResponse.json({ assignment }, { status: 201 });
}
