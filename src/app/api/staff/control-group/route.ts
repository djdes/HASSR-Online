import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { loadControlGroup } from "@/lib/control-group.server";
import { hasCapability } from "@/lib/permission-presets";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/staff/control-group — участники контроль-группы и кандидаты.
 *
 *   members[]    — сотрудники с пресетом `control_group`: должность и кратко
 *                  их «Иерархия» (`ManagerScope`: кого видят, задачи каких
 *                  журналов назначают; `scope.sees` / `scope.assigns` —
 *                  готовые строки, остальное — для своей вёрстки);
 *   candidates[] — кого можно «Добавить»: активные сотрудники организации
 *                  вне контроль-группы, кроме себя (себе набор без
 *                  «Администратора» не поставить — см. staff-preset-change).
 *
 * Сборка списков — `loadControlGroup` (её же читает страница
 * `/settings/control-group`).
 *
 * Добавить / убрать — `POST /api/staff/[id]/preset` с `control_group` / null
 * (`canManage` — может ли текущий пользователь это делать).
 * Доступ: руководитель (как у «Иерархии»).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!hasFullWorkspaceAccess({ role: session.user.role, isRoot: session.user.isRoot === true })) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  // Контрольная группа — на всю компанию (аудит 2026-11-01): страница
  // руководителю точки закрыта, а здесь люди всех точек.
  if (isPointScoped(session.user)) {
    return NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  const { members, candidates } = await loadControlGroup(organizationId, session.user.id);

  return NextResponse.json({
    members,
    candidates,
    canManage: hasCapability(session.user, "admin.full"),
  });
}
