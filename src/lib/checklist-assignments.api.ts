import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { localClock, onceDueInPast, type ChecklistAssignmentInput } from "@/lib/checklist-assignments";
import { loadAssignmentContext, targetName } from "@/lib/checklist-assignments.server";

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

/**
 * Проверка ссылок формы внутри организации: шаблон, «кому», проверяющий.
 * Чужой или пропавший id — ошибка 404, как у остальных маршрутов.
 */
export async function validateAssignmentRefs(organizationId: string, input: ChecklistAssignmentInput, now: Date): Promise<NextResponse | null> {
  const template = await db.checklistTemplate.findFirst({ where: { id: input.templateId, organizationId, archived: false }, select: { id: true } });
  if (!template) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  const context = await loadAssignmentContext(organizationId);
  if (!targetName(input.targetKind, input.targetId, context)) {
    return NextResponse.json({ error: "Получатель не найден — выберите точку, должность или сотрудника" }, { status: 404 });
  }
  if (input.verifierUserId && !context.people.some((person) => person.id === input.verifierUserId)) {
    return NextResponse.json({ error: "Проверяющий не найден" }, { status: 404 });
  }
  if (onceDueInPast(input, localClock(now, context.timeZone))) {
    return NextResponse.json({ error: "Дата и время срока уже прошли — выберите будущие" }, { status: 400 });
  }
  return null;
}
