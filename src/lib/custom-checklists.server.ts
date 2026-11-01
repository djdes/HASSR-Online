import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { canWriteJournal, canFinalizeJournal, hasJournalAccess } from "@/lib/journal-acl";
import { hasCapability } from "@/lib/permission-presets";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { checklistPointArea, inspectionInArea } from "@/lib/checklist-point-scope";
import { visibleObjectBuildingIds } from "@/lib/point-objects.server";

export async function requireChecklistAccess(operation: "read" | "write" | "finalize" | "manage" = "read") {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const allowed = operation === "manage" ? hasCapability(auth.session.user, "journals.manage")
    : await (operation === "write" ? canWriteJournal : operation === "finalize" ? canFinalizeJournal : hasJournalAccess)(auth.session.user, CHECKLIST_CODE);
  if (!allowed) return { ok: false as const, response: NextResponse.json({ error: "Нет доступа к чек-листам" }, { status: 403 }) };
  return { ...auth, organizationId: getActiveOrgId(auth.session), canManage: hasCapability(auth.session.user, "journals.manage") };
}

/**
 * Какие проверки человек может открыть (без права изменять): все — с
 * `journals.manage`, иначе свои и те, где он проверяющий по назначению
 * («Чек-листы → Результаты», 2026-10-19).
 */
export function checklistInspectionReadWhere(input: { organizationId: string; canManage: boolean; userId: string }) {
  return {
    organizationId: input.organizationId,
    ...(input.canManage ? {} : { OR: [{ createdById: input.userId }, { assignment: { verifierUserId: input.userId } }] }),
  };
}

/**
 * Проверки в области человека (2026-11-01, «точка видит только своё»):
 * точка из шапки, у руководителя точки — его точки. По назначению — по его
 * точке, без назначения и по должности — по точкам автора; свои и те, где
 * человек проверяющий, — всегда (`inspectionInArea`). Вся организация — все.
 */
export async function checklistInspectionsInArea<T extends { createdById: string; assignmentId: string | null }>(
  session: Session,
  organizationId: string,
  rows: T[],
): Promise<T[]> {
  const others = rows.filter((row) => row.createdById !== session.user.id);
  if (others.length === 0) return rows;
  const points = await visibleObjectBuildingIds(session);
  if (!points) return rows;
  const assignmentIds = [...new Set(others.flatMap((row) => (row.assignmentId ? [row.assignmentId] : [])))];
  const assignments = assignmentIds.length
    ? await db.checklistAssignment.findMany({
        where: { organizationId, id: { in: assignmentIds } },
        select: { id: true, targetKind: true, targetId: true, verifierUserId: true },
      })
    : [];
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const personIds = [
    ...new Set([...others.map((row) => row.createdById), ...assignments.flatMap((item) => (item.targetKind === "user" ? [item.targetId] : []))]),
  ];
  // Уволенные тоже: автор старой проверки мог уйти, а точка у проверки осталась.
  const [buildings, people] = await Promise.all([
    db.building.findMany({ where: { organizationId }, select: { id: true } }),
    db.user.findMany({ where: { organizationId, id: { in: personIds } }, select: { id: true, buildingIds: true } }),
  ]);
  const area = checklistPointArea({ points, buildings, people });
  return rows.filter((row) =>
    inspectionInArea(
      area,
      { createdById: row.createdById, assignment: row.assignmentId ? (byId.get(row.assignmentId) ?? null) : null },
      session.user.id,
    ),
  );
}

/** Одна проверка в области человека; вне области маршрут отвечает «не найдена». */
export async function checklistInspectionInArea(
  session: Session,
  organizationId: string,
  inspection: { createdById: string; assignmentId: string | null },
): Promise<boolean> {
  return (await checklistInspectionsInArea(session, organizationId, [inspection])).length > 0;
}

/**
 * PDF проверки (`checklistPdfResponse`): проверка чужой точки — 404 до
 * сборки файла, нет доступа — тот же отказ; иначе null.
 */
export async function checklistInspectionAreaRefusal(id: string): Promise<NextResponse | null> {
  const auth = await requireChecklistAccess();
  if (!auth.ok) return auth.response;
  const inspection = await db.checklistInspection.findFirst({
    where: { id, ...checklistInspectionReadWhere({ organizationId: auth.organizationId, canManage: auth.canManage, userId: auth.session.user.id }) },
    select: { createdById: true, assignmentId: true },
  });
  if (inspection && !(await checklistInspectionInArea(auth.session, auth.organizationId, inspection))) {
    return NextResponse.json({ error: "Чек-лист не найден" }, { status: 404 });
  }
  return null;
}
