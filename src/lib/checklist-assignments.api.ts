import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { localClock, onceDueInPast, type ChecklistAssignmentInput } from "@/lib/checklist-assignments";
import { loadAssignmentContext, targetName, type AssignmentContext } from "@/lib/checklist-assignments.server";
import { assignmentTargetRefusal, checklistPointArea, type ChecklistPointArea } from "@/lib/checklist-point-scope";
import { isPointScoped } from "@/lib/point-scope";
import { visibleObjectBuildingIds } from "@/lib/point-objects.server";

/**
 * Общие проверки API назначений: чтение — руководству
 * (`hasFullWorkspaceAccess`), изменения — `admin.full` (решение раздела 7:
 * «Назначение» — блок администрации). Организация — всегда из сессии.
 */
export async function requireAssignmentAccess(operation: "read" | "write") {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth;
  const user = auth.session.user;
  const allowed = operation === "write" ? hasCapability(user, "admin.full") : hasFullWorkspaceAccess(user) || hasCapability(user, "admin.full");
  if (!allowed) {
    return { ok: false as const, response: NextResponse.json({ error: "Назначать чек-листы может руководитель" }, { status: 403 }) };
  }
  return { ...auth, organizationId: getActiveOrgId(auth.session) };
}

export type AssignmentScope = { context: AssignmentContext; area: ChecklistPointArea };

/**
 * Люди и точки формы и область человека (2026-11-01, «точка видит только
 * своё»): точка из шапки, у руководителя точки — его точки. Назначения
 * другой точки он не видит и не меняет.
 */
export async function loadAssignmentScope(session: Session, organizationId: string): Promise<AssignmentScope> {
  const [context, points] = await Promise.all([loadAssignmentContext(organizationId), visibleObjectBuildingIds(session)]);
  const area = checklistPointArea({ points, pointScoped: isPointScoped(session.user), buildings: context.buildings, people: context.people });
  return { context, area };
}

/**
 * Проверка ссылок формы внутри организации: шаблон, «кому», проверяющий.
 * Чужой или пропавший id — ошибка 404, как у остальных маршрутов; цель и
 * проверяющий вне области человека — 403 (`keepVerifierUserId` — прежний
 * проверяющий при правке: его можно оставить).
 */
export async function validateAssignmentRefs(
  organizationId: string,
  input: ChecklistAssignmentInput,
  now: Date,
  scope: AssignmentScope,
  keepVerifierUserId?: string | null,
): Promise<NextResponse | null> {
  const template = await db.checklistTemplate.findFirst({ where: { id: input.templateId, organizationId, archived: false }, select: { id: true } });
  if (!template) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  const context = scope.context;
  if (!targetName(input.targetKind, input.targetId, context)) {
    return NextResponse.json({ error: "Получатель не найден — выберите точку, должность или сотрудника" }, { status: 404 });
  }
  if (input.verifierUserId && !context.people.some((person) => person.id === input.verifierUserId)) {
    return NextResponse.json({ error: "Проверяющий не найден" }, { status: 404 });
  }
  const refusal = assignmentTargetRefusal(scope.area, input, keepVerifierUserId);
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });
  if (onceDueInPast(input, localClock(now, context.timeZone))) {
    return NextResponse.json({ error: "Дата и время срока уже прошли — выберите будущие" }, { status: 400 });
  }
  return null;
}
